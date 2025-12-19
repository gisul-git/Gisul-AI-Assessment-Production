"""
Safety tests to run BEFORE and AFTER refactoring.

All these imports must work identically before and after refactoring.

Usage:
    # Before refactoring (establish baseline):
    pytest tests/test_refactoring_safety.py -v > tests/refactoring_baseline.txt
    
    # After refactoring (verify nothing broke):
    pytest tests/test_refactoring_safety.py -v > tests/refactoring_after.txt
    diff tests/refactoring_baseline.txt tests/refactoring_after.txt
"""
import pytest
import inspect
from typing import get_type_hints


class TestRefactoringSafety:
    """Test suite to ensure backward compatibility after refactoring."""
    
    def test_all_public_imports_work(self):
        """Test all 18 public functions/constants can be imported."""
        from app.api.v1.assessments.topic_service_v2 import (
            # Primary functions (9)
            generate_topics_v2,
            generate_topics_unified,
            generate_topics_from_requirements_v2,
            generate_questions_for_row_v2,
            generate_questions_for_topic_v2,
            improve_topic,
            regenerate_question,
            validate_topic_category,
            ai_topic_suggestion,
            # Internal functions used externally (9)
            _is_technical_topic_ai,
            _get_openai_client,
            _v2_is_aiml_execution_topic,
            _v2_is_sql_execution_topic,
            _v2_contains_any,
            V2_WEB_KEYWORDS,
            contains_unsupported_framework,
            filter_topics_with_coding_unsupported,
            is_judge0_supported,
        )
        # If we reach here, all imports worked
        assert True
    
    def test_generate_topics_v2_signature(self):
        """Ensure generate_topics_v2 signature remains unchanged."""
        from app.api.v1.assessments.topic_service_v2 import generate_topics_v2
        
        sig = inspect.signature(generate_topics_v2)
        params = list(sig.parameters.keys())
        
        expected = [
            'assessment_title',
            'job_designation',
            'selected_skills',
            'experience_min',
            'experience_max',
            'experience_mode'
        ]
        
        assert params == expected, f"Signature changed! Got: {params}, Expected: {expected}"
    
    def test_generate_questions_for_row_v2_signature(self):
        """Ensure generate_questions_for_row_v2 signature remains unchanged."""
        from app.api.v1.assessments.topic_service_v2 import generate_questions_for_row_v2
        
        sig = inspect.signature(generate_questions_for_row_v2)
        params = list(sig.parameters.keys())
        
        expected = [
            'topic_label',
            'question_type',
            'difficulty',
            'questions_count',
            'can_use_judge0',
            'coding_language',
            'additional_requirements',
            'experience_mode',
            'website_summary',
            'company_context'
        ]
        
        assert params == expected, f"Signature changed! Got: {params}, Expected: {expected}"
    
    def test_v2_web_keywords_is_list(self):
        """Ensure V2_WEB_KEYWORDS is still a list."""
        from app.api.v1.assessments.topic_service_v2 import V2_WEB_KEYWORDS
        
        assert isinstance(V2_WEB_KEYWORDS, list), f"V2_WEB_KEYWORDS is not a list, got: {type(V2_WEB_KEYWORDS)}"
        assert len(V2_WEB_KEYWORDS) > 0, "V2_WEB_KEYWORDS is empty"
        assert all(isinstance(item, str) for item in V2_WEB_KEYWORDS), "V2_WEB_KEYWORDS contains non-string items"
    
    def test_judge0_supported_function_works(self):
        """Test is_judge0_supported function works."""
        from app.api.v1.assessments.topic_service_v2 import is_judge0_supported
        
        # Test with supported language
        assert is_judge0_supported("python") == True
        assert is_judge0_supported("java") == True
        
        # Test with unsupported framework
        assert is_judge0_supported("django") == False
        assert is_judge0_supported("react") == False
    
    def test_v2_contains_any_function_works(self):
        """Test _v2_contains_any function works."""
        from app.api.v1.assessments.topic_service_v2 import _v2_contains_any
        
        assert _v2_contains_any("python programming", ["python", "java"]) == True
        assert _v2_contains_any("javascript code", ["python", "java"]) == False
    
    def test_contains_unsupported_framework_function_works(self):
        """Test contains_unsupported_framework function works."""
        from app.api.v1.assessments.topic_service_v2 import contains_unsupported_framework
        
        is_framework, name = contains_unsupported_framework("django web framework")
        assert is_framework == True
        assert name == "django"
        
        is_framework, name = contains_unsupported_framework("python programming")
        assert is_framework == False
    
    def test_routers_imports_still_work(self):
        """Test that routers.py imports still work."""
        # Simulate the import from routers.py
        try:
            from app.api.v1.assessments.topic_service_v2 import (
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
            assert True
        except ImportError as e:
            pytest.fail(f"routers.py imports failed: {e}")
    
    def test_usethislogic_imports_still_work(self):
        """Test that usethislogic.py imports still work."""
        # Simulate the import from usethislogic.py
        try:
            from app.api.v1.assessments.topic_service_v2 import (
                _v2_is_aiml_execution_topic,
                _v2_is_sql_execution_topic,
                _v2_contains_any,
                V2_WEB_KEYWORDS,
                contains_unsupported_framework,
                filter_topics_with_coding_unsupported,
                is_judge0_supported
            )
            assert True
        except ImportError as e:
            pytest.fail(f"usethislogic.py imports failed: {e}")
    
    def test_module_is_importable(self):
        """Test that the module itself can be imported."""
        import app.api.v1.assessments.topic_service_v2 as ts
        
        assert hasattr(ts, 'generate_topics_v2')
        assert hasattr(ts, 'generate_questions_for_row_v2')
        assert hasattr(ts, 'V2_WEB_KEYWORDS')
    
    def test_all_exports_in_all(self):
        """Test that __all__ contains all expected exports."""
        import app.api.v1.assessments.topic_service_v2 as ts
        
        if hasattr(ts, '__all__'):
            expected_exports = {
                'generate_topics_v2',
                'generate_topics_unified',
                'generate_topics_from_requirements_v2',
                'generate_questions_for_row_v2',
                'generate_questions_for_topic_v2',
                'improve_topic',
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
            }
            
            actual_exports = set(ts.__all__)
            missing = expected_exports - actual_exports
            extra = actual_exports - expected_exports
            
            assert len(missing) == 0, f"Missing exports: {missing}"
            # Allow extra exports (they might add more later)
            # assert len(extra) == 0, f"Unexpected exports: {extra}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])



