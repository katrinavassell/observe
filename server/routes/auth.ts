import { Router, Request, Response, NextFunction } from 'express'
import type { Pool } from 'pg'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { apiKeyStore } from '../api-key-store.js'

declare module 'express-session' {
  interface SessionData {
    visitorId: string
    accountId: number
    accountEmail: string
  }
}

export interface AuthRequest extends Request {
  visitorId?: string
  accountId?: number
  accountEmail?: string
}

export function createEnsureVisitor(pool: Pool) {
  return async function ensureVisitor(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.session.visitorId) {
        const visitorId = crypto.randomUUID()
        req.session.visitorId = visitorId

        await pool.query(
          'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [visitorId, 'none']
        )
      }
      req.visitorId = req.session.visitorId
      if (req.session.accountId) {
        req.accountId = req.session.accountId
        req.accountEmail = req.session.accountEmail
      }
      next()
    } catch (error) {
      console.error('Visitor session error:', error)
      res.status(500).json({ error: 'Session error' })
    }
  }
}

function regenerateSession(req: AuthRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const visitorId = req.session.visitorId
    req.session.regenerate((err) => {
      if (err) return reject(err)
      req.session.visitorId = visitorId
      resolve()
    })
  })
}

export function createAuthRoutes(pool: Pool, ensureVisitor: ReturnType<typeof createEnsureVisitor>) {
  const router = Router()

  router.get('/session/init', ensureVisitor, async (req: AuthRequest, res: Response) => {
    res.json({
      visitorId: req.visitorId,
      account: req.session.accountId ? {
        id: req.session.accountId,
        email: req.session.accountEmail,
      } : null,
    })
  })

  router.post('/auth/signup', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const { email, password, name } = req.body
      if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required' })
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' })
      }
      if (name && typeof name !== 'string') {
        return res.status(400).json({ error: 'Name must be a string' })
      }

      const normalizedEmail = email.toLowerCase().trim()
      const existing = await pool.query('SELECT id FROM accounts WHERE email = $1', [normalizedEmail])
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const result = await pool.query(
        'INSERT INTO accounts (email, password_hash, name, visitor_id) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
        [normalizedEmail, passwordHash, name?.trim() || null, req.visitorId]
      )
      const account = result.rows[0]

      await regenerateSession(req)
      req.session.accountId = account.id
      req.session.accountEmail = account.email

      res.json({ account: { id: account.id, email: account.email, name: account.name } })
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with this email already exists' })
      }
      console.error('Signup error:', error)
      res.status(500).json({ error: 'Failed to create account' })
    }
  })

  router.post('/auth/login', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const { email, password } = req.body
      if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required' })
      }

      const normalizedEmail = email.toLowerCase().trim()
      const result = await pool.query(
        'SELECT id, email, name, password_hash, visitor_id FROM accounts WHERE email = $1',
        [normalizedEmail]
      )
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      const account = result.rows[0]
      const passwordValid = await bcrypt.compare(password, account.password_hash)
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }

      const visitorIdToUse = account.visitor_id || req.visitorId
      if (!account.visitor_id) {
        await pool.query('UPDATE accounts SET visitor_id = $1 WHERE id = $2', [req.visitorId, account.id])
      }

      await regenerateSession(req)
      req.session.visitorId = visitorIdToUse
      req.session.accountId = account.id
      req.session.accountEmail = account.email

      res.json({ account: { id: account.id, email: account.email, name: account.name } })
    } catch (error) {
      console.error('Login error:', error)
      res.status(500).json({ error: 'Failed to log in' })
    }
  })

  router.post('/auth/logout', (req: AuthRequest, res: Response) => {
    apiKeyStore.delete(req.session.id)
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err)
        return res.status(500).json({ error: 'Failed to log out' })
      }
      res.clearCookie('pa.sid')
      res.json({ success: true })
    })
  })

  router.get('/auth/me', ensureVisitor, async (req: AuthRequest, res: Response) => {
    if (!req.session.accountId) {
      return res.json({ account: null })
    }
    try {
      const result = await pool.query(
        'SELECT id, email, name FROM accounts WHERE id = $1',
        [req.session.accountId]
      )
      if (result.rows.length === 0) {
        req.session.accountId = undefined as any
        req.session.accountEmail = undefined as any
        return res.json({ account: null })
      }
      res.json({ account: result.rows[0] })
    } catch (error) {
      console.error('Auth me error:', error)
      res.status(500).json({ error: 'Failed to get account info' })
    }
  })

  return router
}
