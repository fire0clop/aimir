from passlib.context import CryptContext

pwd_context = CryptContext(
    schemes=["bcrypt_sha256", "bcrypt"],
    deprecated="auto",
)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

print(hash_password("LG6-Y33-QtH-Zey"))
