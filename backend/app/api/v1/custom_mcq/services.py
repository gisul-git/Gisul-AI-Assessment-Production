"""
Services for Custom MCQ Test module.
Handles CSV parsing, validation, and test creation.
"""
from __future__ import annotations

import csv
import io
import logging
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

REQUIRED_COLUMNS = ["section", "question", "optionA", "optionB", "optionC", "optionD", "correctAnswer", "marks"]
MAX_QUESTIONS = 2000


def parse_csv_content(csv_content: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Parse CSV content and return rows and errors.
    
    Args:
        csv_content: CSV file content as string
        
    Returns:
        Tuple of (rows, errors)
    """
    errors = []
    rows = []
    
    try:
        # Handle different line endings
        csv_content = csv_content.replace('\r\n', '\n').replace('\r', '\n')
        
        # Parse CSV
        reader = csv.DictReader(io.StringIO(csv_content))
        
        # Check required columns
        if not reader.fieldnames:
            errors.append("CSV file is empty or invalid")
            return rows, errors
        
        # Log actual column names for debugging
        logger.debug(f"CSV columns found: {reader.fieldnames}")
        
        # Normalize fieldnames and create mapping
        fieldnames_lower = {col.lower().strip(): col for col in reader.fieldnames}
        required_lower = {col.lower() for col in REQUIRED_COLUMNS}
        
        missing_columns = required_lower - set(fieldnames_lower.keys())
        if missing_columns:
            errors.append(f"Missing required columns: {', '.join(missing_columns)}")
            errors.append(f"Found columns: {', '.join(reader.fieldnames)}")
            return rows, errors
        
        # Create a mapping from original column names to normalized names
        column_mapping = {}
        for orig_col in reader.fieldnames:
            normalized_col = orig_col.lower().strip()
            column_mapping[normalized_col] = orig_col
        
        # Read and validate rows
        for row_num, row in enumerate(reader, start=2):  # Start at 2 (header is row 1)
            # Skip empty rows (all values are empty, None, or whitespace)
            if not any(v and (str(v).strip() if v else "") for v in row.values()):
                continue
            
            # Normalize column names (case-insensitive) - map original columns to normalized keys
            normalized_row = {}
            for orig_key, value in row.items():
                normalized_key = orig_key.lower().strip()
                # Use the normalized key consistently
                # Handle None values and ensure we have a string
                if value is None:
                    normalized_row[normalized_key] = ""
                else:
                    normalized_row[normalized_key] = str(value).strip() if value else ""
            
            # Debug: Log first row to help diagnose issues
            if row_num == 2:
                logger.debug(f"First data row keys: {list(normalized_row.keys())}")
                logger.debug(f"First data row sample: {normalized_row}")
            
            # Validate row
            row_errors = validate_csv_row(normalized_row, row_num)
            if row_errors:
                errors.extend(row_errors)
                # Log the actual row data for debugging
                if row_num <= 6:  # Only log first few errors to avoid spam
                    logger.debug(f"Row {row_num} validation failed. Row data: {normalized_row}")
                continue
            
            rows.append(normalized_row)
        
        # Check max questions limit
        if len(rows) > MAX_QUESTIONS:
            errors.append(f"Maximum {MAX_QUESTIONS} questions allowed. Found {len(rows)} questions.")
        
    except Exception as e:
        logger.exception(f"Error parsing CSV: {e}")
        errors.append(f"Error parsing CSV file: {str(e)}")
    
    return rows, errors


def validate_csv_row(row: Dict[str, str], row_num: int) -> List[str]:
    """
    Validate a single CSV row.
    
    IMPORTANT: Only 4 options (A, B, C, D) are supported for MCQ questions.
    
    Args:
        row: Dictionary representing a CSV row (with normalized lowercase keys)
        row_num: Row number for error reporting
        
    Returns:
        List of error messages (empty if valid)
    """
    errors = []
    
    # Check required fields are not empty (using lowercase normalized keys)
    for col in REQUIRED_COLUMNS:
        col_lower = col.lower()
        if col_lower not in row:
            errors.append(f"Row {row_num}: Missing column '{col}' (normalized as '{col_lower}')")
        elif not row[col_lower] or not row[col_lower].strip():
            errors.append(f"Row {row_num}: Missing or empty '{col}' field")
    
    if errors:
        return errors
    
    # Validate that all 4 options are provided and not empty (using lowercase keys)
    for option_col, option_letter in [("optiona", "A"), ("optionb", "B"), ("optionc", "C"), ("optiond", "D")]:
        if option_col not in row:
            errors.append(f"Row {row_num}: Missing column 'option{option_letter}' (normalized as '{option_col}')")
        elif not row[option_col] or not row[option_col].strip():
            errors.append(f"Row {row_num}: Missing or empty 'option{option_letter}' field")
    
    if errors:
        return errors
    
    # Validate correctAnswer (must be exactly A, B, C, or D - only 4 options supported)
    if "correctanswer" not in row:
        errors.append(f"Row {row_num}: Missing column 'correctAnswer'")
    else:
        correct_answer = row["correctanswer"].upper().strip()
        if correct_answer not in ["A", "B", "C", "D"]:
            errors.append(f"Row {row_num}: correctAnswer must be exactly A, B, C, or D (only 4 options supported). Found: '{row['correctanswer']}'")
    
    # Validate marks
    if "marks" not in row:
        errors.append(f"Row {row_num}: Missing column 'marks'")
    else:
        try:
            marks = int(row["marks"])
            if marks <= 0:
                errors.append(f"Row {row_num}: marks must be greater than 0. Found: {marks}")
        except ValueError:
            errors.append(f"Row {row_num}: marks must be an integer. Found: '{row['marks']}'")
    
    # Validate section is not empty
    if "section" not in row:
        errors.append(f"Row {row_num}: Missing column 'section'")
    else:
        section = row["section"].strip()
        if not section:
            errors.append(f"Row {row_num}: section cannot be empty")
    
    return errors


def group_questions_by_section(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group questions by section.
    
    Args:
        rows: List of validated CSV rows
        
    Returns:
        Dictionary mapping section names to lists of questions
    """
    sections = {}
    
    for row in rows:
        section_name = row["section"].strip()
        if section_name not in sections:
            sections[section_name] = []
        
        question = {
            "question": row["question"].strip(),
            "optionA": row["optiona"].strip(),
            "optionB": row["optionb"].strip(),
            "optionC": row["optionc"].strip(),
            "optionD": row["optiond"].strip(),
            "correctAnswer": row["correctanswer"].upper().strip(),
            "marks": int(row["marks"]),
        }
        
        sections[section_name].append(question)
    
    return sections


def generate_csv_template() -> str:
    """
    Generate a CSV template with headers and sample rows.
    
    IMPORTANT: MCQ questions support exactly 4 options (A, B, C, D) only.
    No additional options (E, F, etc.) are supported.
    
    Returns:
        CSV template as string
    """
    template = """section,question,optionA,optionB,optionC,optionD,correctAnswer,marks
aptitude,What is 2 + 2?,2,3,4,5,C,1
logical_reasoning,If all roses are flowers and some flowers are red which statement is true?,All roses are red,Some roses are red,No roses are red,Cannot be determined,B,2
quantitative,What is the square root of 16?,2,3,4,5,C,1
verbal,Choose the synonym of happy,Sad,Angry,Joyful,Confused,C,1
technical_mcq,What does CPU stand for?,Central Processing Unit,Computer Personal Unit,Central Program Utility,Computer Processing Unit,A,2"""
    return template

