"""Minimal OpenID Connect client (authorization code + PKCE, confidential client) for AAI@EduHr.

The HTTP transport is injectable so tests can route provider calls to the built-in mock provider.
"""

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
import jwt


class OIDCError(Exception):
    pass


@dataclass
class LoginRequest:
    state: str
    nonce: str
    code_verifier: str

    @classmethod
    def new(cls) -> "LoginRequest":
        return cls(secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48))

    @property
    def code_challenge(self) -> str:
        digest = hashlib.sha256(self.code_verifier.encode()).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


class OIDCClient:
    METADATA_TTL = 3600

    def __init__(
        self,
        issuer: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        scopes: str,
        token_auth: str = "client_secret_basic",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.scopes = scopes
        self.token_auth = token_auth
        self.transport = transport
        self._metadata: dict | None = None
        self._metadata_at = 0.0
        self._jwks: dict | None = None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport, timeout=15)

    async def metadata(self) -> dict:
        if self._metadata is None or time.monotonic() - self._metadata_at > self.METADATA_TTL:
            async with self._http() as http:
                response = await http.get(f"{self.issuer}/.well-known/openid-configuration")
            if response.status_code != 200:
                raise OIDCError(f"Discovery failed ({response.status_code})")
            self._metadata = response.json()
            self._metadata_at = time.monotonic()
            self._jwks = None
        return self._metadata

    async def authorization_url(self, login: LoginRequest, prompt: str = "") -> str:
        endpoint = (await self.metadata())["authorization_endpoint"]
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": self.scopes,
            "state": login.state,
            "nonce": login.nonce,
            "code_challenge": login.code_challenge,
            "code_challenge_method": "S256",
        }
        if prompt:
            # Shared school PCs: never reuse the provider's SSO session from the previous student.
            params["prompt"] = prompt
            params["max_age"] = "0"
        return f"{endpoint}?{urlencode(params)}"

    async def exchange_code(self, code: str, login: LoginRequest) -> dict:
        endpoint = (await self.metadata())["token_endpoint"]
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
            "code_verifier": login.code_verifier,
        }
        auth = None
        if self.token_auth == "client_secret_post":
            data.update(client_id=self.client_id, client_secret=self.client_secret)
        else:
            auth = (self.client_id, self.client_secret)
        async with self._http() as http:
            response = await http.post(endpoint, data=data, auth=auth)
        if response.status_code != 200:
            raise OIDCError(f"Token exchange failed ({response.status_code}): {response.text[:200]}")
        return response.json()

    async def _signing_key(self, kid: str | None) -> jwt.PyJWK:
        for refresh in (False, True):
            if self._jwks is None or refresh:
                async with self._http() as http:
                    response = await http.get((await self.metadata())["jwks_uri"])
                self._jwks = response.json()
            keys = jwt.PyJWKSet.from_dict(self._jwks).keys
            match = next((key for key in keys if kid is None or key.key_id == kid), None)
            if match:
                return match
        raise OIDCError("No matching signing key")

    async def validate_id_token(self, id_token: str, nonce: str) -> dict:
        try:
            header = jwt.get_unverified_header(id_token)
            key = await self._signing_key(header.get("kid"))
            claims = jwt.decode(
                id_token,
                key=key.key,
                algorithms=[header.get("alg", "RS256")],
                audience=self.client_id,
                issuer=(await self.metadata()).get("issuer", self.issuer),
                leeway=60,
            )
        except jwt.PyJWTError as exc:
            raise OIDCError(f"Invalid ID token: {exc}") from exc
        if claims.get("nonce") != nonce:
            raise OIDCError("Nonce mismatch")
        return claims

    async def userinfo(self, access_token: str) -> dict:
        endpoint = (await self.metadata()).get("userinfo_endpoint")
        if not endpoint:
            return {}
        async with self._http() as http:
            response = await http.get(endpoint, headers={"Authorization": f"Bearer {access_token}"})
        return response.json() if response.status_code == 200 else {}

    async def end_session_url(self, id_token: str | None, post_logout_redirect_uri: str) -> str | None:
        endpoint = (await self.metadata()).get("end_session_endpoint")
        if not endpoint:
            return None
        params = {"post_logout_redirect_uri": post_logout_redirect_uri, "client_id": self.client_id}
        if id_token:
            params["id_token_hint"] = id_token
        return f"{endpoint}?{urlencode(params)}"
