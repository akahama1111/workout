self.addEventListener("message", async (event) => {
  const { apiKey, model, workoutUrl, prompt } = event.data || {};

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                file_data: {
                  file_uri: workoutUrl,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          response_mime_type: "application/json",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "Gemini APIの呼び出しに失敗しました。");
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
    if (!text) throw new Error("Geminiから抽出結果が返りませんでした。");

    self.postMessage({ ok: true, text });
  } catch (error) {
    self.postMessage({ ok: false, message: error.message || "抽出に失敗しました。" });
  }
});
