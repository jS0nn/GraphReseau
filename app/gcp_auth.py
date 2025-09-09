from __future__ import annotations

from typing import Iterable, Sequence

from .config import settings


def get_credentials(scopes: Sequence[str]):
    """Return google-auth Credentials with proper scopes.

    - If IMPERSONATE_SERVICE_ACCOUNT is set, try to impersonate that SA.
    - If the current ADC are already impersonating the same SA, reuse them directly
      (avoid double-impersonation which can fail without self TokenCreator).
    - Otherwise, return ADC with the requested scopes.
    """
    try:
        import google.auth
        from google.auth.impersonated_credentials import Credentials as ImpersonatedCredentials
    except Exception as exc:
        raise RuntimeError(f"google-auth not available: {exc}")

    target_scopes = list(scopes) if scopes else ["https://www.googleapis.com/auth/cloud-platform"]
    imp_sa = (settings.impersonate_service_account or "").strip()

    # Always get base ADC with target scopes first
    base_creds, _ = google.auth.default(scopes=target_scopes)

    if imp_sa:
        # If ADC are already impersonated for the same SA, reuse them
        try:
            # ImpersonatedCredentials exposes service_account_email for the target principal
            if getattr(base_creds, "service_account_email", None) == imp_sa:
                return base_creds
        except Exception:
            pass

        # Otherwise, mint an access token via IAM service account impersonation
        return ImpersonatedCredentials(
            source_credentials=base_creds,
            target_principal=imp_sa,
            target_scopes=target_scopes,
            lifetime=3600,
        )

    # No impersonation requested: use ADC as-is
    return base_creds
