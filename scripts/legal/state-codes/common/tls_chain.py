"""Complete a server's missing intermediate certificate from its own AIA caIssuers URL.

Some official hosts (observed: www.cga.ct.gov, le.utah.gov) serve a leaf certificate without
the intermediate, so strict verification fails with "unknown CA". This is a server
misconfiguration, not a gate. We fetch the issuer certificate named in the leaf's own
Authority Information Access extension, add it to the certifi roots in a local bundle and keep
certificate verification ON: the leaf must still chain to a trusted root and match the host.
Verification is never disabled.
"""
import pathlib
import socket
import ssl

import certifi
import requests
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtensionOID

from provenance_fetch import Fetcher


def issuer_pems(host, port=443):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, port), 20) as sock, ctx.wrap_socket(sock, server_hostname=host) as s:
        leaf = x509.load_der_x509_certificate(s.getpeercert(binary_form=True))
    aia = leaf.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_INFORMATION_ACCESS).value
    out = []
    for desc in aia:
        if desc.access_method != AuthorityInformationAccessOID.CA_ISSUERS:
            continue
        data = requests.get(desc.access_location.value, timeout=30).content
        try:
            cert = x509.load_der_x509_certificate(data)
        except ValueError:
            cert = x509.load_pem_x509_certificate(data)
        out.append((desc.access_location.value, cert.public_bytes(serialization.Encoding.PEM)))
    return out


def build_bundle(hosts, dest):
    """Write certifi roots + AIA-fetched issuers for hosts to dest; return list of issuer URLs used."""
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    pem = pathlib.Path(certifi.where()).read_bytes()
    used = []
    for host in hosts:
        for url, p in issuer_pems(host):
            pem += b"\n" + p
            used.append({"host": host, "issuer_url": url})
    dest.write_bytes(pem)
    return used


class TlsFetcher(Fetcher):
    """Fetcher whose session trusts certifi + the AIA-completed issuers of aia_hosts."""

    def __init__(self, state, root, aia_hosts=(), **kw):
        super().__init__(state, root, **kw)
        if aia_hosts:
            bundle = self.root / "tls-bundle.pem"
            self.tls_issuers = build_bundle(aia_hosts, bundle)
            self.session.verify = str(bundle)
