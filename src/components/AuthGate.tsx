import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface AuthGateProps {
  user: User | null
  children: React.ReactNode
}

type Mode = 'signin' | 'signup' | 'reset'
type AuthState = 'idle' | 'loading' | 'error' | 'sent'

export function AuthGate({ user, children }: AuthGateProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  if (user) return <>{children}</>

  const switchMode = (m: Mode) => {
    setMode(m)
    setErrorMsg('')
    setAuthState('idle')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthState('loading')
    setErrorMsg('')
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password)
      } else if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await sendPasswordResetEmail(auth, email)
        setAuthState('sent')
        return
      }
      setAuthState('idle')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (mode === 'reset') {
        // Neutral message to avoid email enumeration
        setAuthState('sent')
        return
      }
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setErrorMsg('Incorrect email or password.')
      } else if (msg.includes('email-already-in-use')) {
        setErrorMsg('An account with this email already exists.')
      } else if (msg.includes('weak-password')) {
        setErrorMsg('Password must be at least 6 characters.')
      } else if (msg.includes('too-many-requests')) {
        setErrorMsg('Too many attempts. Try again later.')
      } else {
        setErrorMsg(mode === 'signin' ? 'Sign-in failed. Check your connection.' : 'Sign-up failed. Check your connection.')
      }
      setAuthState('error')
    }
  }

  const subtitle =
    mode === 'signin' ? 'Sign in to continue'
    : mode === 'signup' ? 'Create an account'
    : 'Reset your password'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">CC Matcher</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <Card>
          {/* Mode toggle — hidden in reset mode */}
          {mode !== 'reset' && (
            <div className="flex border-b border-border">
              {(['signin', 'signup'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mode === m ? 'text-foreground border-b-2 border-foreground -mb-px' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {m === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>
          )}

          <CardContent className="pt-4">
            {/* Reset: sent confirmation */}
            {mode === 'reset' && authState === 'sent' ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-muted-foreground">
                  If that email is registered, you'll receive a reset link shortly.
                </p>
                <button
                  onClick={() => switchMode('signin')}
                  className="text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="you@example.com"
                  />
                </div>

                {mode !== 'reset' && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="password">Password</label>
                    <input
                      id="password"
                      type="password"
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="••••••••"
                    />
                  </div>
                )}

                {authState === 'error' && errorMsg && (
                  <p className="text-xs text-destructive">{errorMsg}</p>
                )}

                <Button type="submit" className="w-full" disabled={authState === 'loading'}>
                  {authState === 'loading'
                    ? (mode === 'reset' ? 'Sending…' : mode === 'signin' ? 'Signing in…' : 'Creating account…')
                    : (mode === 'reset' ? 'Send reset email' : mode === 'signin' ? 'Sign in' : 'Create account')}
                </Button>

                {/* Forgot password link — sign-in mode only */}
                {mode === 'signin' && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {/* Back to sign in — reset mode */}
                {mode === 'reset' && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Back to sign in
                    </button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
