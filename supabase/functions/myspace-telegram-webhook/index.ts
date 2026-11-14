// Legacy Telegram login webhook is retired. Acknowledge Telegram updates so they are not retried.
// Telegram publication after explicit approval is handled separately by myspace-publish.
Deno.serve(req=>new Response("retired",{status:req.method==="POST"?200:405,headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}}));

