try { require('dotenv').config() } catch (e) {}

const express = require('express')
const cors    = require('cors')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

app.listen(3000, () => console.log('foco. corriendo en http://localhost:3000'))
