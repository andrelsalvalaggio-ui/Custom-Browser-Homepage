export default {
  async fetch(request, env, ctx) {
    // 1. Trata CORS para a extensão conseguir chamar o Worker
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Lê a chave configurada no painel da Cloudflare
    const accessKey = env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      return new Response(
        JSON.stringify({ error: "UNSPLASH_ACCESS_KEY não configurada no Worker." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("query") || "nature";

    try {
      // 3. Busca foto aleatória do Unsplash garantindo ZERO cache na Cloudflare
      const response = await fetch(
        `https://api.unsplash.com/photos/random?orientation=landscape&query=${encodeURIComponent(query)}&_t=${Date.now()}`,
        {
          headers: {
            "Authorization": `Client-ID ${accessKey}`,
            "Accept-Version": "v1",
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: `Unsplash API error: ${response.statusText}`, details: errorText }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();

      // 4. Contabiliza o download nos termos do Unsplash em segundo plano
      if (data.links?.download_location) {
        ctx.waitUntil(
          fetch(`${data.links.download_location}?client_id=${accessKey}`)
        );
      }

      // 5. Retorna os dados com o ID da imagem
      const result = {
        id: data.id,
        rawUrl: data.urls.raw,
        smallUrl: data.urls.small,
        color: data.color,
        authorName: data.user.name,
        authorProfile: `${data.user.links.html}?utm_source=custom_homepage&utm_medium=referral`
      };

      // 6. Cabeçalhos rigorosos para PROIBIR a Cloudflare e o navegador de guardarem cache dessa resposta
      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0"
        },
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
