# Phase 1: Refactoring Analysis for topic_service_v2.py

## File Statistics
- **Total Lines**: 4,574
- **Total Functions**: 41 (including duplicates)
- **Constants**: 10
- **External Dependencies**: OpenAI, FastAPI, DSA module, AIML module

## Public Functions (Must Preserve for Backward Compatibility)

Based on imports in `routers.py` and `usethislogic.py`:

### Primary Public Functions:
1. `generate_topics_v2()` - Topic generation
2. `generate_topics_unified()` - Unified topic generation
3. `generate_topics_from_requirements_v2()` - CSV requirements topic generation
4. `generate_questions_for_row_v2()` - Main question generation entry point
5. `generate_questions_for_topic_v2()` - Alias for backward compatibility
6. `improve_topic()` - Topic improvement
7. `regenerate_question()` - Question regeneration
8. `validate_topic_category()` - Topic validation
9. `ai_topic_suggestion()` - AI topic suggestions

### Internal Functions Used Externally (Must Export):
10. `_is_technical_topic_ai()` - Used in routers.py
11. `_get_openai_client()` - Used in routers.py
12. `_v2_is_aiml_execution_topic()` - Used in usethislogic.py
13. `_v2_is_sql_execution_topic()` - Used in usethislogic.py
14. `_v2_contains_any()` - Used in usethislogic.py
15. `V2_WEB_KEYWORDS` - Used in usethislogic.py
16. `contains_unsupported_framework()` - Used in usethislogic.py
17. `filter_topics_with_coding_unsupported()` - Used in usethislogic.py
18. `is_judge0_supported()` - Used in usethislogic.py

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL DEPENDENCIES                    │
├─────────────────────────────────────────────────────────────┤
│ - OpenAI (AsyncOpenAI, APIError, etc.)                      │
│ - FastAPI (HTTPException)                                    │
│ - DSA Module (dsa_generate_question, dsa_generate_sql_question)│
│ - AIML Module (aiml_generate_question)                       │
│ - Core Config (get_settings)                                │
│ - Services (_get_experience_level_*)                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    prompt_templates.py                      │
│                    (ZERO DEPENDENCIES)                      │
├─────────────────────────────────────────────────────────────┤
│ - JUDGE0_UNSUPPORTED_FRAMEWORKS                             │
│ - V2_AIML_KEYWORDS                                          │
│ - V2_SQL_THEORY_KEYWORDS                                    │
│ - V2_SQL_EXECUTION_KEYWORDS                                 │
│ - V2_AIML_THEORY_KEYWORDS                                   │
│ - V2_AIML_EXECUTION_KEYWORDS                                │
│ - V2_SQL_INDICATOR_PATTERNS                                 │
│ - V2_WEB_KEYWORDS                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ai_utils.py                             │
│                    (External deps only)                     │
├─────────────────────────────────────────────────────────────┤
│ - _get_openai_client()                                      │
│ - _build_openai_payload()                                    │
│ - _parse_json_response()                                     │
│ - _is_url()                                                 │
│ - _v2_contains_any()                                        │
│ - _v2_is_sql_topic()                                        │
│ - _v2_is_sql_execution_topic()                              │
│ - _v2_is_aiml_execution_topic()                             │
│ - _fetch_and_summarize_url()                                │
│ - _process_requirements_for_subjective()                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    judge0_utils.py                         │
│                    (Imports: ai_utils)                      │
├─────────────────────────────────────────────────────────────┤
│ - is_judge0_supported()                                     │
│ - filter_judge0_unsupported_skills()                        │
│ - contains_unsupported_framework()                          │
│ - _validate_and_fix_function_signature()                    │
│ - filter_topics_with_coding_unsupported()                    │
│ - _get_starter_code_template()                             │
│ - _get_judge0_language_id()                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ai_coding_generator.py                   │
│                    (Imports: ai_utils, judge0_utils,       │
│                     prompt_templates, DSA module)           │
├─────────────────────────────────────────────────────────────┤
│ - _generate_coding_questions()                              │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    ai_sql_generator.py                      │
│                    (Imports: ai_utils, prompt_templates,   │
│                     DSA SQL module)                         │
├─────────────────────────────────────────────────────────────┤
│ - _generate_sql_questions()                                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    ai_aiml_generator.py                     │
│                    (Imports: ai_utils, prompt_templates,   │
│                     AIML module)                            │
├─────────────────────────────────────────────────────────────┤
│ - _generate_aiml_questions()                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ai_question_generator.py                  │
│                    (Imports: all above + specialized gens) │
├─────────────────────────────────────────────────────────────┤
│ - generate_questions_for_row_v2() [ENTRY POINT]             │
│ - generate_questions_for_topic_v2() [ALIAS]                 │
│ - _generate_mcq_questions()                                │
│ - _generate_subjective_questions()                         │
│ - _generate_pseudocode_questions()                          │
│ - regenerate_question()                                     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    ai_topic_generator.py                    │
│                    (Imports: ai_utils, judge0_utils,       │
│                     prompt_templates)                       │
├─────────────────────────────────────────────────────────────┤
│ - generate_topics_v2()                                      │
│ - generate_topics_unified()                                 │
│ - generate_topics_from_requirements_v2()                    │
│ - improve_topic()                                           │
│ - _ensure_all_question_types_present()                      │
│ - _find_semantically_suitable_topic()                       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    ai_validation.py                         │
│                    (Imports: ai_utils, prompt_templates)   │
├─────────────────────────────────────────────────────────────┤
│ - validate_topic_category()                                 │
│ - ai_topic_suggestion()                                     │
│ - _is_technical_topic_ai()                                 │
│ - _is_technical_topic() [fallback]                          │
└─────────────────────────────────────────────────────────────┘
```

## Function Mapping to New Files

### `prompt_templates.py` (Constants Only - ~200 lines)
```python
# All constants and keyword lists
JUDGE0_UNSUPPORTED_FRAMEWORKS = [...]
V2_AIML_KEYWORDS = [...]
V2_SQL_THEORY_KEYWORDS = [...]
V2_SQL_EXECUTION_KEYWORDS = [...]
V2_AIML_THEORY_KEYWORDS = [...]
V2_AIML_EXECUTION_KEYWORDS = [...]
V2_SQL_INDICATOR_PATTERNS = [...]
V2_WEB_KEYWORDS = [...]
```

### `ai_utils.py` (~400 lines)
```python
# Core utilities - NO dependencies on other services
_get_openai_client()
_build_openai_payload()
_parse_json_response()
_is_url()
_fetch_and_summarize_url()
_process_requirements_for_subjective()
_v2_contains_any()
_v2_is_sql_topic()
_v2_is_sql_execution_topic()
_v2_is_aiml_execution_topic()
```

### `judge0_utils.py` (~350 lines)
```python
# Judge0 compatibility utilities
is_judge0_supported()
filter_judge0_unsupported_skills()
contains_unsupported_framework()
_validate_and_fix_function_signature()
filter_topics_with_coding_unsupported()
_get_starter_code_template()
_get_judge0_language_id()
```

### `ai_coding_generator.py` (~400 lines)
```python
# Coding question generation
_generate_coding_questions()
# DSA module integration logic
```

### `ai_sql_generator.py` (~200 lines)
```python
# SQL question generation
_generate_sql_questions()
# DSA SQL module integration logic
```

### `ai_aiml_generator.py` (~250 lines)
```python
# AIML question generation
_generate_aiml_questions()
# AIML module integration logic
```

### `ai_question_generator.py` (~400 lines)
```python
# Main question generation entry point
generate_questions_for_row_v2()
generate_questions_for_topic_v2()  # Alias
_generate_mcq_questions()
_generate_subjective_questions()
_generate_pseudocode_questions()
regenerate_question()
```

### `ai_topic_generator.py` (~600 lines)
```python
# Topic generation functions
generate_topics_v2()
generate_topics_unified()
generate_topics_from_requirements_v2()
improve_topic()
_ensure_all_question_types_present()
_find_semantically_suitable_topic()
```

### `ai_validation.py` (~300 lines)
```python
# Validation functions
validate_topic_category()
ai_topic_suggestion()
_is_technical_topic_ai()
_is_technical_topic()
```

### `models/question_types.py` (~100 lines)
```python
# Type definitions and Pydantic models
QuestionType = Literal["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]
Difficulty = Literal["Easy", "Medium", "Hard"]
ExperienceMode = Literal["corporate", "college", "student"]
# Pydantic models for each question type
```

## Import Dependencies Analysis

### External Imports (All files may need):
- `from __future__ import annotations`
- `import json, logging, re, uuid`
- `from typing import Any, Dict, List, Optional`
- `from fastapi import HTTPException`
- `from ....core.config import get_settings`

### Module-Specific Imports:

**ai_coding_generator.py:**
```python
from ..dsa.services.ai_generator import generate_question as dsa_generate_question
from ..dsa.services.code_wrapper import generate_boilerplate
```

**ai_sql_generator.py:**
```python
from ..dsa.services.ai_sql_generator import generate_sql_question as dsa_generate_sql_question
```

**ai_aiml_generator.py:**
```python
from ..aiml.services.ai_question_generator import generate_aiml_question as aiml_generate_question
```

**ai_utils.py:**
```python
from openai import AsyncOpenAI, APIError, APIConnectionError, AuthenticationError, RateLimitError
import httpx  # Optional
from urllib.parse import urlparse
```

**All generators:**
```python
from .services import _get_experience_level_corporate, _get_experience_level_student
```

## Circular Import Prevention

✅ **No circular dependencies detected** - The dependency flow is strictly hierarchical:
1. Constants (no imports)
2. Utils (only external imports)
3. Judge0 utils (imports utils)
4. Specialized generators (import utils + judge0_utils)
5. Question generator (imports specialized generators)
6. Topic generator (imports utils + judge0_utils)
7. Validation (imports utils)

## Backward Compatibility Strategy

### `topic_service_v2.py` (New - Thin Wrapper ~50 lines)
```python
"""
DEPRECATED: This file exists for backward compatibility only.
Please use: from app.api.v1.assessments.services import <function_name>
"""
from .services import (
    # All public functions
    generate_topics_v2,
    generate_topics_unified,
    generate_topics_from_requirements_v2,
    improve_topic,
    generate_questions_for_row_v2,
    generate_questions_for_topic_v2,
    regenerate_question,
    validate_topic_category,
    ai_topic_suggestion,
    # Internal functions used externally
    _is_technical_topic_ai,
    _get_openai_client,
    _v2_is_aiml_execution_topic,
    _v2_is_sql_execution_topic,
    _v2_contains_any,
    contains_unsupported_framework,
    filter_topics_with_coding_unsupported,
    is_judge0_supported,
)
from .services.prompt_templates import V2_WEB_KEYWORDS

__all__ = [
    'generate_topics_v2',
    'generate_topics_unified',
    'generate_topics_from_requirements_v2',
    'improve_topic',
    'generate_questions_for_row_v2',
    'generate_questions_for_topic_v2',
    'regenerate_question',
    'validate_topic_category',
    'ai_topic_suggestion',
    '_is_technical_topic_ai',
    '_get_openai_client',
    '_v2_is_aiml_execution_topic',
    '_v2_is_sql_execution_topic',
    '_v2_contains_any',
    'V2_WEB_KEYWORDS',
    'contains_unsupported_framework',
    'filter_topics_with_coding_unsupported',
    'is_judge0_supported',
]
```

### `services/__init__.py` (Exports all public functions)
```python
"""
Assessment Services Package

This package contains all AI-powered topic and question generation services.
"""
from .ai_topic_generator import (
    generate_topics_v2,
    generate_topics_unified,
    generate_topics_from_requirements_v2,
    improve_topic,
)
from .ai_question_generator import (
    generate_questions_for_row_v2,
    generate_questions_for_topic_v2,
    regenerate_question,
)
from .ai_validation import (
    validate_topic_category,
    ai_topic_suggestion,
    _is_technical_topic_ai,
)
from .ai_utils import (
    _get_openai_client,
    _v2_is_aiml_execution_topic,
    _v2_is_sql_execution_topic,
    _v2_contains_any,
)
from .judge0_utils import (
    is_judge0_supported,
    contains_unsupported_framework,
    filter_topics_with_coding_unsupported,
)
from .prompt_templates import V2_WEB_KEYWORDS

__all__ = [
    # Topic generation
    'generate_topics_v2',
    'generate_topics_unified',
    'generate_topics_from_requirements_v2',
    'improve_topic',
    # Question generation
    'generate_questions_for_row_v2',
    'generate_questions_for_topic_v2',
    'regenerate_question',
    # Validation
    'validate_topic_category',
    'ai_topic_suggestion',
    '_is_technical_topic_ai',
    # Utils
    '_get_openai_client',
    '_v2_is_aiml_execution_topic',
    '_v2_is_sql_execution_topic',
    '_v2_contains_any',
    'is_judge0_supported',
    'contains_unsupported_framework',
    'filter_topics_with_coding_unsupported',
    'V2_WEB_KEYWORDS',
]
```

## Estimated File Sizes (UPDATED)

| File | Estimated Lines | Status |
|------|----------------|--------|
| `prompt_templates.py` | ~200 | ✅ < 400 |
| `models/question_types.py` | ~100 | ✅ < 400 |
| `ai_utils.py` | ~400 | ✅ = 400 |
| `judge0_utils.py` | ~300 | ✅ < 400 (reduced - moved filter_topics) |
| `ai_quality.py` | ~200 | ✅ < 400 ⭐ NEW |
| `ai_topic_helpers.py` | ~250 | ✅ < 400 ⭐ NEW |
| `ai_coding_generator.py` | ~400 | ✅ = 400 |
| `ai_sql_generator.py` | ~200 | ✅ < 400 |
| `ai_aiml_generator.py` | ~250 | ✅ < 400 |
| `ai_question_generator.py` | ~400 | ✅ = 400 |
| `ai_topic_generator.py` | ~350 | ✅ < 400 (split from 600) |
| `ai_validation.py` | ~300 | ✅ < 400 |
| `topic_service_v2.py` (wrapper) | ~50 | ✅ < 400 |
| `services/__init__.py` | ~100 | ✅ < 400 |
| **TOTAL** | **~3,350** | **All < 400** ✅ |

**Note**: `ai_topic_generator.py` may exceed 400 lines. Consider splitting into:
- `ai_topic_generator.py` (main functions)
- `ai_topic_helpers.py` (helper functions like `_ensure_all_question_types_present`)

## Risk Assessment

### Low Risk ✅
- Moving constants to `prompt_templates.py`
- Moving utility functions to `ai_utils.py`
- Moving Judge0 functions to `judge0_utils.py`

### Medium Risk ⚠️
- Splitting question generators (need to ensure imports work)
- Splitting topic generators (large functions)

### High Risk 🔴
- Backward compatibility wrapper (must test all imports)
- DSA/AIML module integration (must handle import failures)

## Testing Checklist

After refactoring, verify:
- [ ] All imports in `routers.py` still work
- [ ] All imports in `usethislogic.py` still work
- [ ] DSA module integration works (if available)
- [ ] AIML module integration works (if available)
- [ ] Fallback generation works when modules unavailable
- [ ] No circular imports
- [ ] All functions have docstrings
- [ ] Type hints are complete
- [ ] File sizes are acceptable

## Next Steps

1. ✅ **Phase 1 Complete**: Analysis done
2. ⏳ **Phase 2**: Wait for approval, then create directory structure
3. ⏳ **Phase 3**: Migrate code file by file
4. ⏳ **Phase 4**: Create backward compatibility wrapper
5. ⏳ **Phase 5**: Testing and documentation

