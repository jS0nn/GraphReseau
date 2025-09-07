from __future__ import annotations

from typing import Iterable, Sequence

from .config import settings


def get_credentials(scopes: Sequence[str]):
    """Return google-auth Credentials with proper scopes.

    If IMPERSONATE_SERVICE_ACCOUNT/GOOGLE_IMPERSONATE_SERVICE_ACCOUNT is set,
    mint an access token via IAM service account impersonation with the target scopes.
    Otherwise, fall back to Application Default Credentials with the requested scopes.
    """
    try:
        import google.auth
        from google.auth.impersonated_credentials import Credentials as ImpersonatedCredentials
    except Exception as exc:
        raise RuntimeError(f"google-auth not available: {exc}")

    target_scopes = list(scopes) if scopes else ["https://www.googleapis.com/auth/cloud-platform"]
    imp_sa = (settings.impersonate_service_account or "").strip()

    if imp_sa:
        # Base credentials (user or workstation) with cloud-platform are enough to mint impersonated tokens
        base_creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return ImpersonatedCredentials(
            source_credentials=base_creds,
            target_principal=imp_sa,
            target_scopes=target_scopes,
            lifetime=3600,
        )

    # No impersonation: request ADC with needed scopes
    creds, _ = google.auth.default(scopes=target_scopes)
    return creds

