"""The local browser origins and Host values the loopback development servers accept.

One parser for ``LM_ALLOWED_ORIGINS`` (the model proxy, the director and the generator all read it), and one rule for
the Host header each server accepts (a guard against DNS rebinding: a page on another name that resolves to 127.0.0.1
still sends its own name as Host). Standard library only, so importing it constructs nothing.

``LM_ALLOWED_ORIGINS`` is a comma-separated list of explicit origins, each ``http://<host>:<port>`` with host
127.0.0.1, localhost or [::1] and a port from 1 to 65535. Origins are returned in the form browsers send: the scheme
and host lower-cased, and the default port 80 left out (``http://localhost:80`` becomes ``http://localhost``).
Wildcards, ``null``, https, paths, queries, fragments, user info and other hosts are refused.
"""
from __future__ import annotations

from urllib.parse import urlsplit

DEFAULT_ALLOWED_ORIGINS = "http://127.0.0.1:8000,http://localhost:8000"
LOCAL_ORIGIN_HOSTS = frozenset(("127.0.0.1", "localhost", "::1"))
LOOPBACK_HOST_NAMES = ("127.0.0.1", "localhost")
_DEFAULT_HTTP_PORT = 80


def parse_allowed_origins(value: str) -> frozenset[str]:
    """Return the canonical explicit local HTTP origins in ``value``; raise ValueError for anything else."""
    origins = set()
    for raw_origin in value.split(","):
        origin = raw_origin.strip()
        if not origin or any(char.isspace() for char in origin) or "?" in origin or "#" in origin:
            raise ValueError("LM_ALLOWED_ORIGINS must contain explicit local HTTP origins")
        try:
            parsed = urlsplit(origin)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("LM_ALLOWED_ORIGINS contains a malformed origin") from exc
        if (parsed.scheme.lower() != "http" or parsed.hostname not in LOCAL_ORIGIN_HOSTS
                or parsed.username is not None or parsed.password is not None
                or parsed.path or port is None or not 1 <= port <= 65535):
            raise ValueError("LM_ALLOWED_ORIGINS must contain explicit local HTTP origins with ports")
        host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
        origins.add(f"http://{host}" if port == _DEFAULT_HTTP_PORT else f"http://{host}:{port}")
    return frozenset(origins)


def allowed_hosts(port: int) -> frozenset[str]:
    """The Host values a server bound to 127.0.0.1:``port`` accepts: its loopback names with the port, and without
    it on port 80, where clients leave the default port out."""
    hosts = {f"{name}:{port}" for name in LOOPBACK_HOST_NAMES}
    if port == _DEFAULT_HTTP_PORT:
        hosts.update(LOOPBACK_HOST_NAMES)
    return frozenset(hosts)
