"""Script to migrate files to api/v1 structure and fix imports."""
import os
import re
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).parent / "app"

def fix_imports_in_file(file_path: Path, is_router: bool = False):
    """Fix imports in a moved file."""
    content = file_path.read_text(encoding='utf-8')
    
    # Fix relative imports: .. -> ... (one more level up)
    content = re.sub(r'from \.\.core\.', 'from ...core.', content)
    content = re.sub(r'from \.\.db\.', 'from ...db.', content)
    content = re.sub(r'from \.\.utils\.', 'from ...utils.', content)
    content = re.sub(r'from \.\.models\.', 'from ...models.', content)
    content = re.sub(r'from \.\.middleware\.', 'from ...middleware.', content)
    content = re.sub(r'from \.\.exceptions\.', 'from ...exceptions.', content)
    content = re.sub(r'from \.\.config\.', 'from ...config.', content)
    
    # Fix schema imports: ..schemas.X -> .schemas (relative to same module)
    content = re.sub(r'from \.\.schemas\.(\w+) import', r'from .schemas import', content)
    
    # Fix service imports: ..services.X -> .services (relative to same module)
    content = re.sub(r'from \.\.services\.(\w+) import', r'from .services import', content)
    
    # Fix DSA imports: ..dsa -> ...api.v1.dsa
    content = re.sub(r'from \.\.dsa\.', 'from ...api.v1.dsa.', content)
    
    # Fix router prefix for v1
    if is_router:
        content = re.sub(
            r'router = APIRouter\(prefix="/api/(\w+)",',
            r'router = APIRouter(prefix="/api/v1/\1",',
            content
        )
        # Special case for candidate (uses /api/assessment not /api/candidate)
        content = re.sub(
            r'router = APIRouter\(prefix="/api/assessment",',
            r'router = APIRouter(prefix="/api/v1/assessment",',
            content
        )
    
    file_path.write_text(content, encoding='utf-8')
    print(f"✓ Fixed imports in {file_path}")

def main():
    """Main migration function."""
    print("Starting migration to api/v1 structure...")
    
    # 1. Copy assessments files
    print("\n1. Copying assessments files...")
    shutil.copy(BASE_DIR / "routers" / "assessments.py", BASE_DIR / "api" / "v1" / "assessments" / "routers.py")
    shutil.copy(BASE_DIR / "schemas" / "assessment.py", BASE_DIR / "api" / "v1" / "assessments" / "schemas.py")
    shutil.copy(BASE_DIR / "services" / "ai.py", BASE_DIR / "api" / "v1" / "assessments" / "services.py")
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "assessments" / "routers.py", is_router=True)
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "assessments" / "schemas.py")
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "assessments" / "services.py")
    
    # 2. Copy candidate files
    print("\n2. Copying candidate files...")
    shutil.copy(BASE_DIR / "routers" / "candidate.py", BASE_DIR / "api" / "v1" / "candidate" / "routers.py")
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "candidate" / "routers.py", is_router=True)
    
    # 3. Copy proctor files
    print("\n3. Copying proctor files...")
    shutil.copy(BASE_DIR / "routers" / "proctor.py", BASE_DIR / "api" / "v1" / "proctor" / "routers.py")
    shutil.copy(BASE_DIR / "schemas" / "proctor.py", BASE_DIR / "api" / "v1" / "proctor" / "schemas.py")
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "proctor" / "routers.py", is_router=True)
    fix_imports_in_file(BASE_DIR / "api" / "v1" / "proctor" / "schemas.py")
    
    # 4. Copy DSA folder
    print("\n4. Copying DSA folder...")
    dsa_source = BASE_DIR / "dsa"
    dsa_dest = BASE_DIR / "api" / "v1" / "dsa"
    if dsa_dest.exists():
        shutil.rmtree(dsa_dest)
    shutil.copytree(dsa_source, dsa_dest)
    
    # Fix imports in DSA routers
    dsa_routers = dsa_dest / "routers"
    if dsa_routers.exists():
        for router_file in dsa_routers.glob("*.py"):
            if router_file.name != "__init__.py":
                fix_imports_in_file(router_file, is_router=True)
    
    print("\n✓ Migration complete!")
    print("\nNext steps:")
    print("1. Extract generate-questions-from-config to api/v2/assessments/routers.py")
    print("2. Remove it from api/v1/assessments/routers.py")
    print("3. Update main.py to import from new locations")

if __name__ == "__main__":
    main()









