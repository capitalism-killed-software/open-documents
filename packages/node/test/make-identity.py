"""A made-up certificate authority and signer for the signing tests, written into a folder:
ca.pem (the trust root), signer.p12 (password "secret") and other-ca.pem (an unrelated root)."""

import datetime
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

FROM = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
UNTIL = datetime.datetime(2040, 1, 1, tzinfo=datetime.timezone.utc)


def authority(name):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    cert = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(FROM).not_valid_after(UNTIL)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(True, False, False, False, False, True, True, False, False), critical=True)
        .sign(key, hashes.SHA256())
    )
    return key, cert


def main(folder):
    out = Path(folder)
    ca_key, ca = authority("Example Test Authority")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    signer = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Sam Signer")]))
        .issuer_name(ca.subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(FROM).not_valid_after(UNTIL)
        .add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    (out / "ca.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (out / "signer.p12").write_bytes(pkcs12.serialize_key_and_certificates(
        b"signer", key, signer, [ca], serialization.BestAvailableEncryption(b"secret")))
    _, other = authority("Someone Else")
    (out / "other-ca.pem").write_bytes(other.public_bytes(serialization.Encoding.PEM))


if __name__ == "__main__":
    main(sys.argv[1])
