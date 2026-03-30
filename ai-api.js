class AIClient {
    constructor() {
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
    }

    setKey(key) {
        this.apiKey = key.trim();
        if (this.apiKey) {
            localStorage.setItem('gemini_api_key', this.apiKey);
        } else {
            localStorage.removeItem('gemini_api_key');
        }
    }

    async initAvailableModel() {
        if (!this.apiKey) return null;
        if (this.cachedModelName) return this.cachedModelName;

        try {
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
            const res = await fetch(listUrl);
            const data = await res.json();
            
            if (data.models && data.models.length > 0) {
                // generateContent をサポートしているモデルのみを抽出
                const validModels = data.models.filter(m => 
                    m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
                );
                
                // 優先順位: 2.5-flash -> 2.0-flash -> 1.5-flash -> その他のflash -> pro系
                let selected = validModels.find(m => m.name.includes('gemini-2.5-flash'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-2.0-flash'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-1.5-flash'));
                if (!selected) selected = validModels.find(m => m.name.includes('flash'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-2.5-pro'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-2.0-pro'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-1.5-pro'));
                if (!selected) selected = validModels.find(m => m.name.includes('gemini-pro'));
                // 最終フォールバック (ただし、無料枠がない可能性のある3.1等は避けるため、とりあえずリストの最初)
                if (!selected) selected = validModels[0];
                
                if (selected) {
                    this.cachedModelName = selected.name;
                    console.log("Selected Model:", this.cachedModelName);
                    return this.cachedModelName;
                }
            }
            throw new Error("利用可能なモデルが見つかりませんでした。");
        } catch (e) {
            console.error("Failed to fetch models list:", e);
            // フォールバック
            return 'models/gemini-1.5-flash';
        }
    }

    async callAPI(prompt) {
        if (!this.apiKey) {
            return this.getMockResponse(prompt);
        }
        
        try {
            const modelName = await this.initAvailableModel();
            // modelName は "models/gemini-1.5-flash" のような形式で返ってくるためそのまま利用可能
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${this.apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { 
                        temperature: 0.7,
                        maxOutputTokens: 8192,
                    }
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                console.error("API Error Response", data);
                throw new Error(data.error?.message || "API通信エラーが発生しました。");
            }

            if (data.candidates && data.candidates.length > 0) {
                return data.candidates[0].content.parts[0].text;
            } else {
                throw new Error("AIから有効な応答がありませんでした。");
            }
        } catch(e) {
            console.error("AI Client Error:", e);
            throw e;
        }
    }

    async generateTitles(keyword) {
        const prompt = `「${keyword}」をテーマにしたnote記事の魅力的なタイトル候補を5つ生成してください。
返答は以下の形式のJSONリスト**のみ**としてください。（Markdownのコードブロックなどを付けずに、そのままJSONとして解析可能な文字列を返してください。）
["タイトル候補1", "タイトル候補2", "タイトル候補3", "タイトル候補4", "タイトル候補5"]`;
        
        const result = await this.callAPI(prompt);
        
        if (!this.apiKey) {
            return JSON.parse(result); // Mock is already returning JSON string and handled correctly
        }

        try {
            const cleanStr = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const titles = JSON.parse(cleanStr);
            if(Array.isArray(titles) && titles.length > 0){
                return titles;
            }
            throw new Error("フォーマット不正");
        } catch(e) {
            console.warn("JSON parse failed, splitting by newline. Content:", result);
            const lines = result.split('\n').filter(l => l.trim().length > 0);
            return lines.map(l => l.replace(/^[-*0-9.)\]"'\s]+/, '').replace(/["']+$/, '').trim()).slice(0, 5);
        }
    }

    async generateOutline(title) {
        const prompt = `以下のタイトルでnote記事を書くための構成案を作成してください。

タイトル：${title}

出力要件：
・フォーマットはMarkdown形式にしてください
・導入文、見出し1〜3、まとめ で構成してください
・各見出しの下に、どのような内容を書くか簡単な説明を箇条書きで添えてください`;
        
        return this.callAPI(prompt);
    }

    async generateBody(title, outline) {
        const prompt = `以下の構成案に沿って、noteで読まれるための魅力的で読みやすい記事の本文を作成してください。

タイトル：${title}

構成案：
${outline}

執筆ルール：
・全体で2000字〜3000字程度を目安にしっかり書き込んでください。
・noteの読者に親近感を持たれるような、丁寧で読みやすい文体（です・ます調）にしてください。
・適度に改行や空行を入れ、スマホでも読みやすくしてください。
・Markdown形式（#、##を用いた見出し、太字など）を使って構造化してください。
・「はじめに」から「まとめ」まで、自然な流れで一つの記事として完成させてください。`;
        
        const content = await this.callAPI(prompt);
        // 本文が返ってきたら、最初にタイトルを付ける（マークダウンで）
        return `# ${title}\n\n${content}`;
    }

    async getMockResponse(prompt) {
        await new Promise(r => setTimeout(r, 1500)); // Simulate network latency

        if(prompt.includes('タイトル候補を5つ')) {
            return JSON.stringify([
                "【モックアップ】中小企業がAI活用を進めるための最初の一歩",
                "【モックアップ】現場の負担を劇的に減らす！今日から始めるAI業務改善",
                "【モックアップ】AI導入で失敗しないための3つの重要なポイント",
                "【モックアップ】50代からでも全く遅くない、AI時代の学び直し術",
                "【モックアップ】お金をかけずに実現する、スマートな業務効率化の全手順"
            ]);
        }
        
        if(prompt.includes('構成案を作成')) {
            return `## はじめに
・なぜ今、このテーマが重要なのかを読者の共感を呼ぶ形で解説する。

## 現場で起きている課題
・人員不足と属人化
・時間がないという心理的ハードル

## 解決策の具体例
・日常業務（メール作成、議事録作成）へのAI適用
・無料で使えるおすすめツール紹介

## 導入の注意点
・いきなり全社に導入せず、小さく始めることの重要性

## まとめ
・AIは仕事のパートナーであるという意識付け
・読者の背中を押す前向きなメッセージ`;
        }
        
        if(prompt.includes('本文を作成')) {
            return `## はじめに

近年、AI（人工知能）の進化は目覚ましく、関連するニュースを見ない日はありません。
「うちの会社にもそろそろAIを導入すべきだろうか…」
そんなふうに悩んでいる中小企業の経営者や担当者の方も多いのではないでしょうか。

しかし、いざ始めようとしても、「何から手をつければいいのかわからない」「高額なシステム投資が必要なのでは？」といった心理的なハードルがあるのが現実です。
実のところ、AIの活用はもっと身近で、今あるパソコンとインターネットだけで手軽に始められるものなのです。

この記事では、中小企業が無理なくAI活用を進めるための「最初の一歩」について、実践的なアドバイスをお届けします。

---

## 現場で起きている課題

多くの企業で今起きているのは、深刻な人員不足や業務の属人化といった課題です。

- ベテラン社員の退職によるノウハウの喪失
- 日々のルーティンワークに追われ、新しいことに挑戦する時間が全く取れない
- 若手への教育コストが重くのしかかる

こういった状況を打破し、少しでも「ゆとり」を生み出すために、AIは非常に強力なツールとなります。人間が不得意な単純作業や情報整理をAIに任せることで、本来人間がやるべき「考える仕事」に集中できるようになるのです。

---

## 解決策の具体例

では、具体的に何から始めればよいのでしょうか。
私は「日常業務の些細な部分」をAIにお願いしてみることをおすすめしています。

例えば、毎日のメールの文面作成や、会議の議事録の要約といった部分です。
ChatGPTなどの無料で使えるAIツールを開き、「以下の箇条書きから、取引先への丁寧な依頼メールを作成して」と指示を出すだけで、わずか数秒で整った文章が完成します。

これだけでも、1回あたり5分の時間短縮になり、ちりも積もれば大きな業務改善に繋がります。「習うより慣れろ」の精神で、まずは触ってみて効果を実感することが重要です。

---

## 導入の注意点

AI活用を進める上で、最も気をつけたいポイントがあります。それは、「いきなり全社に一斉導入しようとしない」ことです。

新しいツールにはどうしても抵抗感が伴います。
まずは一部の部署や、新しいものに興味があるメンバー数人だけで「スモールスタート」を切りましょう。そこで「これは便利だ！」「仕事が早くなった！」という小さな成功体験を積み重ねることが、結果的に全社展開への一番の近道となります。

---

## まとめ

AI活用の本質は、決して人の仕事を奪うことではありません。
人がより創造的な仕事に集中できるよう、優秀なアシスタントを雇うような感覚に近いです。

焦る必要はありません。まずは小さく、今日からできる一歩を踏み出してみませんか。
この記事が、皆さんの会社のAI活用を後押しする一つのきっかけになれば嬉しく思います。`;
        }
        
        return "テストデータです。";
    }
}

// Global Export
window.aiClient = new AIClient();
