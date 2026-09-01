import { useEffect, useRef, useState } from 'react';
import { exchangeGoogleCredential, renderGoogleSignInButton, type CloudSession } from '../../persistence/cloudAuth';
import './GoogleSignInButton.css';

/** Botão oficial do Google, montado imperativamente pelo próprio script deles num container. */
export function GoogleSignInButton({ onSignedIn }: { onSignedIn: (session: CloudSession) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    renderGoogleSignInButton(containerRef.current, async (credential) => {
      try {
        const session = await exchangeGoogleCredential(credential);
        onSignedIn(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [onSignedIn]);

  return (
    <div className="google-signin">
      <div ref={containerRef} />
      {error && <p className="google-signin__error">{error}</p>}
    </div>
  );
}
