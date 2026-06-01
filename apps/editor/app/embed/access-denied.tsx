/**
 * Access denied screen shown when the /embed token validation fails.
 * Server component — no client-side interactivity needed.
 */

import Link from 'next/link'

type DenialReason =
  | 'no_token'
  | 'no_secret'
  | 'malformed'
  | 'bad_signature'
  | 'expired'

interface AccessDeniedProps {
  reason: DenialReason
}

function getMessage(reason: DenialReason): { title: string; description: string } {
  switch (reason) {
    case 'no_token':
      return {
        title: 'Acces restricționat',
        description:
          'Această pagină este disponibilă doar prin link emis din aplicația Deviz Masbalt. Deschide aplicația și apasă butonul „Vezi 3D" de pe pagina unui deviz.',
      }
    case 'expired':
      return {
        title: 'Link expirat',
        description:
          'Acest link 3D a expirat (valabil 24 ore din momentul generării). Întoarce-te în Deviz Masbalt și apasă din nou butonul „Vezi 3D" pentru a genera un link nou.',
      }
    case 'bad_signature':
    case 'malformed':
      return {
        title: 'Link invalid',
        description:
          'Acest link nu este recunoscut sau a fost modificat. Întoarce-te în Deviz Masbalt și folosește butonul oficial „Vezi 3D" pentru a deschide proiectul 3D.',
      }
    case 'no_secret':
      return {
        title: 'Configurare incompletă',
        description:
          'Serverul nu este configurat corect (lipsește MASBALT_HMAC_SECRET). Contactează administratorul.',
      }
    default:
      return {
        title: 'Acces interzis',
        description: 'Acest link nu poate fi accesat.',
      }
  }
}

export default function EmbedAccessDenied({ reason }: AccessDeniedProps) {
  const { title, description } = getMessage(reason)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          Embed mode
        </p>
        <h1 className="mt-2 font-semibold text-lg">{title}</h1>
        <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            className="rounded-md border border-border bg-background px-4 py-2 font-medium text-sm hover:bg-accent/40"
            href="/"
          >
            Înapoi
          </Link>
        </div>
        <p className="mt-6 font-mono text-muted-foreground text-[10px] uppercase tracking-wide">
          reason: {reason}
        </p>
      </div>
    </div>
  )
}
