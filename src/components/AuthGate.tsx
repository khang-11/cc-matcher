import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { isAllowlisted } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AuthGateProps {
  user: User | null
  /** Called once the user is verified as allowlisted */
  children: React.ReactNode
}

type AuthState = 'idle' | 'loading' | 'not-allowlisted' | 'error'

export function AuthGate({ user, children }: AuthGateProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Already signed in and allowlisted — render the app
  if (user) return <>{children}</>

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthState('loading')
    setErrorMsg('')
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const allowed = await isAllowlisted(cred.user.email ?? '')
      if (!allowed) {
        await signOut(auth)
        setAuthState('not-allowlisted')
        return
      }
      // Auth state change in App.tsx will re-render with user set
      setAuthState('idle')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      // Simplify Firebase error messages for end users
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setErrorMsg('Incorrect email or password.')
      } else if (msg.includes('too-many-requests')) {
        setErrorMsg('Too many attempts. Try again later.')
      } else {
        setErrorMsg('Sign-in failed. Check your connection and try again.')
      }
      setAuthState('error')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">CC Matcher</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="email">
                  Email
                </label>
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

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="••••••••"
                />
              </div>

              {authState === 'not-allowlisted' && (
                <p className="text-xs text-destructive">
                  Your account doesn't have access to this app.
                </p>
              )}
              {authState === 'error' && errorMsg && (
                <p className="text-xs text-destructive">{errorMsg}</p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={authState === 'loading'}
              >
                {authState === 'loading' ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
