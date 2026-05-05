try { require('dotenv').config() } catch (e) {}

const express = require('express')
const https   = require('https')
const cors    = require('cors')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

/* ── Proxy Claude API ── */
app.post('/api/claude', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en .env' })
  }

  const body = JSON.stringify(req.body)

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(body),
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01'
    }
  }

  const proxyReq = https.request(options, proxyRes => {
    let data = ''
    proxyRes.on('data', chunk => { data += chunk })
    proxyRes.on('end', () => {
      try { res.json(JSON.parse(data)) }
      catch { res.status(500).json({ error: 'Respuesta inválida de la API' }) }
    })
  })

  proxyReq.on('error', err => res.status(500).json({ error: err.message }))
  proxyReq.write(body)
  proxyReq.end()
})

app.listen(3000, () => console.log('foco. corriendo en http://localhost:3000'))
