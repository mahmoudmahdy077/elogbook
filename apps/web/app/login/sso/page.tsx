// P1.4: SSO disabled until complete SAML/OIDC implementation is verified

export default async function SsoPage() {
  return (
    <div className="min-h-dvh bg-[#F2F2F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-black/5 rounded-2xl p-6 sm:p-8 text-center space-y-3">
          <h1 className="text-lg font-heading font-semibold text-text-primary">SSO Unavailable</h1>
          <p className="text-sm text-text-muted">
            SSO is not available. Enterprise SSO is not yet enabled.
          </p>
          <a href="/login" className="inline-block text-sm text-[#007AFF] hover:underline">
            Back to sign-in
          </a>
        </div>
      </div>
    </div>
  );
}
