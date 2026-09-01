// Proxy server-side a la API de Anthropic. La API key vive solo acá (env),
// nunca llega al front. El front manda {model, max_tokens, system, messages}
// y espera de vuelta la respuesta cruda de Anthropic (usa data.content[0].text).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ type: 'error', error: { message: 'Método no permitido.' } })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY no configurada en el entorno de Vercel.')
    return res.status(500).json({ type: 'error', error: { message: 'IA no disponible en el servidor.' } })
  }

  const { model, max_tokens, system, messages } = req.body || {}
  if (!model || !max_tokens || !messages) {
    return res.status(400).json({ type: 'error', error: { message: 'Body inválido.' } })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens, system, messages })
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    console.error('Error al llamar a Anthropic:', err.message)
    res.status(502).json({ type: 'error', error: { message: 'Error al conectar con la IA.' } })
  }
}
