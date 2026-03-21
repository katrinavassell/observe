import type { VercelRequest, VercelResponse } from '@vercel/node'
import express from 'express'
import app from '../server/index.js'

const wrapper = express()
wrapper.use('/api', app)

export default function handler(req: VercelRequest, res: VercelResponse) {
  return wrapper(req, res)
}
