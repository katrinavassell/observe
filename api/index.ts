import express from 'express'
import app from '../server/index.js'

// Vercel sends requests with /api prefix, but Express routes have no prefix.
// Mount the Express app under /api so routes match correctly.
const wrapper = express()
wrapper.use('/api', app)

export default wrapper
