// Cloudflare Worker: هر ۵ ساعت workflow گیت‌هاب رو راه می‌اندازه
export default {
  async scheduled(event, env, ctx) {
    const r = await fetch(
      `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/bot.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          'User-Agent': 'cf-worker',
          Accept: 'application/vnd.github+json'
        },
        body: JSON.stringify({ ref: env.GH_BRANCH || 'main' })
      }
    )
    console.log('dispatch status', r.status)
  }
}
