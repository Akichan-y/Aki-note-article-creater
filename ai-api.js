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

    async generateOutline(title, length = 400) {
        let lengthInstruction = "";
        if(length === 100) lengthInstruction = "最終的な記事が【100文字程度】と非常に短くなることを前提に、構成は「導入」と「結論の一言」のみなど、最小限に留めてください。見出しは必要なければゼロでも構いません。";
        if(length === 200) lengthInstruction = "最終的な記事が【200文字程度】と短くなることを前提に、構成は「導入」「トピック1つ」「まとめ」など非常にシンプルにし、見出しを1〜2個程度に絞ってください。";
        if(length === 400) lengthInstruction = "最終的な記事が【400文字程度】の標準的な長さになるよう、見出しを2〜3個程度にしてバランスよく構成してください。";
        if(length === 1000) lengthInstruction = "最終的な記事が【1000文字程度】と詳細な内容になるよう、見出しを3〜4個しっかり設け、内容を深掘りした構成案を作成してください。";

        const prompt = `以下のタイトルでnote記事を書くための構成案を作成してください。

タイトル：${title}

出力要件：
・フォーマットはMarkdown形式にしてください
・${lengthInstruction}
・各見出し（もしあれば）の下に、どのような内容を書くか簡単な説明を箇条書きで添えてください`;
        
        return this.callAPI(prompt);
    }

    async generateBody(title, outline, length = 400) {
        let lengthInstruction = "";
        if(length === 100) lengthInstruction = "100文字程度（ごく短い要約・概要レベル、目安80〜140文字）";
        if(length === 200) lengthInstruction = "200文字程度（短めの本文、目安160〜260文字）";
        if(length === 400) lengthInstruction = "400文字程度（標準的な簡易記事、目安320〜500文字）";
        if(length === 1000) lengthInstruction = "1000文字程度（詳しめの記事、目安800〜1200文字）";

        const prompt = `以下の構成案に完全に沿って、noteで読まれるための魅力的で読みやすい記事の本文を作成してください。

タイトル：${title}

構成案（ユーザー編集後の最終内容）：
${outline}

執筆ルール：
・指定文字数：全体で【${lengthInstruction}】を目安に作成してください。
・構成案にある見出しや補足内容は最優先で記事に反映してください。構成案と関係ない不要なトピックへの脱線は避けてください。
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
        
        if(prompt.includes('指定文字数')) {
            return `## はじめに\n\n近年、AI（人工知能）の進化は目覚ましく、関連するニュースを見ない日はありません。\n「うちの会社にもAIを導入すべきだろうか？」\nそんなふうに悩む担当者の方も多いのではないでしょうか。\n（※ダミーテキストです。本物のAPIキーを設定し、生成を実行すると指定した文字数と構成案に沿った文章が出力されます。）\n\n## 現場で起きる課題と解決策\n\nAI活用の本質は、人の仕事を奪うことではなく、サポート役を入れることです。\nまずは小さく、今日からできる一歩を踏み出してみましょう。`;
        }
        
        return "テストデータです。";
    }

    async generateImagePrompt(article) {
        const excerpt = article.substring(0, 500);
        const prompt = `以下の日本語のnote記事の本文（抜粋）からテーマや雰囲気を汲み取り、画像生成AI（Stable Diffusion等）に渡すための高品質な英語のプロンプト（呪文）を1つ作成してください。

【記事本文】
${excerpt}

【出力要件】
・10〜20単語程度の英単語のカンマ区切りで出力すること（例: modern office, people working, bright lighting, abstract illustration, high quality, flat design）
・文章ではなく、単語（キーワード）の羅列にすること
・余計な説明文や日本語は一切含めず、英語のプロンプト文字列のみを出力すること
・noteの見出し画像（ヘッダー）としてふさわしく、ユーザーの目を引くクリーンでおしゃれな雰囲気のイラストまたは写真になるようなワード（例: beautiful, professional, soft lighting 等）を適度に混ぜること`;
        
        let englishPrompt = await this.callAPI(prompt);
        
        if (englishPrompt === "テストデータです。") {
             englishPrompt = "modern minimal workspace, artificial intelligence concept, glowing network lines, high quality, soft pastel colors, trendy vector illustration";
        }
        
        return englishPrompt.trim();
    }
}

// Global Export
window.aiClient = new AIClient();
