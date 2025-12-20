# Complete Codebase Import Search Results

## Search Date
Generated: Pre-Phase 2 refactoring

## Search Commands Executed
```bash
grep -r "topic_service_v2" backend/
grep -r "from.*topic_service_v2|import.*topic_service_v2" backend/
```

## Results Summary
- **Total files referencing `topic_service_v2`**: 3
  - 1 analysis document (REFACTORING_ANALYSIS.md)
  - 2 actual code files

---

## File 1: `backend/app/api/v1/assessments/routers.py`

**Line**: 78-90

**Imports**:
```python
from .topic_service_v2 import (
    generate_questions_for_row_v2,
    generate_questions_for_topic_v2,
    generate_topics_v2,
    generate_topics_from_requirements_v2,
    generate_topics_unified,
    improve_topic,
    regenerate_question,
    validate_topic_category,
    _is_technical_topic_ai,
    ai_topic_suggestion,
    _get_openai_client,
)
```

**Total Functions Imported**: 11

**Usage Context**: Main API router endpoints for assessments

**Critical**: ✅ Must preserve all 11 imports

---

## File 2: `backend/app/api/v1/assessments/usethislogic.py`

**Line**: 26-34

**Imports**:
```python
from .topic_service_v2 import (
    _v2_is_aiml_execution_topic,
    _v2_is_sql_execution_topic,
    _v2_contains_any,
    V2_WEB_KEYWORDS,
    contains_unsupported_framework,
    filter_topics_with_coding_unsupported,
    is_judge0_supported
)
```

**Total Functions/Constants Imported**: 7

**Usage Context**: Alternative topic generation logic

**Critical**: ✅ Must preserve all 7 imports

---

## File 3: `backend/app/api/v1/assessments/REFACTORING_ANALYSIS.md`

**Type**: Documentation only (not code)

**Action**: No action needed

---

## Complete List of Functions/Constants to Preserve

### Primary Public Functions (9)
1. `generate_topics_v2`
2. `generate_topics_unified`
3. `generate_topics_from_requirements_v2`
4. `generate_questions_for_row_v2`
5. `generate_questions_for_topic_v2`
6. `improve_topic`
7. `regenerate_question`
8. `validate_topic_category`
9. `ai_topic_suggestion`

### Internal Functions Used Externally (9)
10. `_is_technical_topic_ai`
11. `_get_openai_client`
12. `_v2_is_aiml_execution_topic`
13. `_v2_is_sql_execution_topic`
14. `_v2_contains_any`
15. `contains_unsupported_framework`
16. `filter_topics_with_coding_unsupported`
17. `is_judge0_supported`
18. `V2_WEB_KEYWORDS` (constant)

**Total**: 18 functions/constants

---

## Test Files Check

**Searched**: All files matching `**/test*.py` and `**/*test*.py`

**Results**: 
- Found 4 test files in other modules (dsa, aiml)
- **No test files import `topic_service_v2`** ✅

**Action**: No test file updates needed

---

## Other Potential Import Locations Checked

- ✅ Background tasks/celery jobs: None found
- ✅ Migration scripts: None found
- ✅ Utility scripts: None found
- ✅ Other services: None found

---

## Verification Status

✅ **All imports identified and documented**
✅ **No hidden dependencies found**
✅ **Safe to proceed with refactoring**

---

## Backward Compatibility Requirements

### `topic_service_v2.py` (wrapper) must export:

```python
__all__ = [
    # Primary functions (9)
    'generate_topics_v2',
    'generate_topics_unified',
    'generate_topics_from_requirements_v2',
    'generate_questions_for_row_v2',
    'generate_questions_for_topic_v2',
    'improve_topic',
    'regenerate_question',
    'validate_topic_category',
    'ai_topic_suggestion',
    # Internal functions used externally (9)
    '_is_technical_topic_ai',
    '_get_openai_client',
    '_v2_is_aiml_execution_topic',
    '_v2_is_sql_execution_topic',
    '_v2_contains_any',
    'contains_unsupported_framework',
    'filter_topics_with_coding_unsupported',
    'is_judge0_supported',
    'V2_WEB_KEYWORDS',
]
```

---

## Next Steps

1. ✅ Import search complete
2. ⏳ Create safety tests
3. ⏳ Create rollback script
4. ⏳ Backup original file
5. ⏳ Proceed to Phase 2




