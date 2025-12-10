"""Fix DSA imports after moving to api/v1/dsa."""
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent / "app" / "api" / "v1" / "dsa"

def fix_dsa_imports(file_path: Path):
    """Fix imports in DSA files."""
    content = file_path.read_text(encoding='utf-8')
    original = content
    
    # Fix app.dsa.X imports to relative imports
    # app.dsa.database -> .database (same level)
    # app.dsa.models.X -> .models.X
    # app.dsa.services.X -> .services.X
    # app.dsa.utils.X -> .utils.X
    # app.dsa.routers.X -> .routers.X
    # app.dsa.config -> .config
    
    content = re.sub(r'from app\.dsa\.database import', 'from ..database import', content)
    content = re.sub(r'from app\.dsa\.models\.', 'from ..models.', content)
    content = re.sub(r'from app\.dsa\.services\.', 'from ..services.', content)
    content = re.sub(r'from app\.dsa\.utils\.', 'from ..utils.', content)
    content = re.sub(r'from app\.dsa\.routers\.', 'from ..routers.', content)
    content = re.sub(r'from app\.dsa\.config import', 'from ..config import', content)
    
    # Fix app.core imports
    content = re.sub(r'from app\.core\.', 'from ....core.', content)
    
    # Fix router prefixes for DSA routers
    if 'router = APIRouter()' in content and 'routers' in str(file_path):
        # Find the router definition and add prefix
        content = re.sub(
            r'router = APIRouter\(\)',
            r'router = APIRouter(prefix="/api/v1/dsa", tags=["dsa"])',
            content
        )
    
    if content != original:
        file_path.write_text(content, encoding='utf-8')
        print(f"✓ Fixed imports in {file_path}")
        return True
    return False

def main():
    """Fix all DSA file imports."""
    print("Fixing DSA imports...")
    
    # Fix routers
    routers_dir = BASE_DIR / "routers"
    if routers_dir.exists():
        for router_file in routers_dir.rglob("*.py"):
            if router_file.name != "__init__.py":
                fix_dsa_imports(router_file)
    
    # Fix utils
    utils_dir = BASE_DIR / "utils"
    if utils_dir.exists():
        for util_file in utils_dir.rglob("*.py"):
            if util_file.name != "__init__.py":
                fix_dsa_imports(util_file)
    
    # Fix services
    services_dir = BASE_DIR / "services"
    if services_dir.exists():
        for service_file in services_dir.rglob("*.py"):
            if service_file.name != "__init__.py":
                fix_dsa_imports(service_file)
    
    # Fix models
    models_dir = BASE_DIR / "models"
    if models_dir.exists():
        for model_file in models_dir.rglob("*.py"):
            if model_file.name != "__init__.py":
                fix_dsa_imports(model_file)
    
    # Fix database.py and config.py
    for file_name in ["database.py", "config.py"]:
        file_path = BASE_DIR / file_name
        if file_path.exists():
            fix_dsa_imports(file_path)
    
    print("✓ DSA imports fixed!")

if __name__ == "__main__":
    main()





