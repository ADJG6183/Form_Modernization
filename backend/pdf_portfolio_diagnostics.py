"""
PDF Portfolio Diagnostics Utility

This module provides diagnostic functions for validating and testing PDF portfolios.
"""

import os
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from pypdf import PdfReader

# Import our portfolio utilities
from pdf_portfolio_utils import surface_pdf_generator

class PDFPortfolioDiagnostics:
    """
    Diagnostic tools for PDF Portfolio validation and testing
    """
    
    @staticmethod
    def validate_portfolio(portfolio_data, base_file_path=None, surface_file_path=None):
        """
        Validate a PDF portfolio's structure and field configuration
        
        Args:
            portfolio_data: Dictionary containing portfolio data
            base_file_path: Optional path to the base PDF file
            surface_file_path: Optional path to the surface PDF file
            
        Returns:
            dict: Diagnostic results
        """
        results = {
            'timestamp': datetime.utcnow().isoformat(),
            'valid': True,
            'errors': [],
            'warnings': [],
            'info': [],
            'file_checks': {},
            'field_checks': {}
        }
        
        # Check portfolio data structure
        valid, errors = surface_pdf_generator.validate_pdf_portfolio(portfolio_data)
        results['valid'] = valid
        if errors:
            results['errors'].extend(errors)
            
        # Check base file if provided
        if base_file_path and os.path.exists(base_file_path):
            try:
                base_results = {}
                with open(base_file_path, 'rb') as f:
                    reader = PdfReader(f)
                    base_results['pages'] = len(reader.pages)
                    base_results['valid_pdf'] = True
                    base_results['has_fields'] = bool(reader.get_fields())
                    if base_results['has_fields']:
                        results['warnings'].append("Base PDF already contains form fields")
                results['file_checks']['base_file'] = base_results
            except Exception as e:
                results['file_checks']['base_file'] = {
                    'valid_pdf': False,
                    'error': str(e)
                }
                results['errors'].append(f"Base file is not a valid PDF: {str(e)}")
                results['valid'] = False
        elif base_file_path:
            results['errors'].append(f"Base file not found: {base_file_path}")
            results['valid'] = False
            results['file_checks']['base_file'] = {'valid_pdf': False, 'exists': False}
            
        # Check surface file if provided
        if surface_file_path and os.path.exists(surface_file_path):
            try:
                surface_results = {}
                with open(surface_file_path, 'rb') as f:
                    reader = PdfReader(f)
                    surface_results['pages'] = len(reader.pages)
                    surface_results['valid_pdf'] = True
                    
                    # Check fields
                    fields = reader.get_fields()
                    surface_results['has_fields'] = bool(fields)
                    
                    # Get field count by type
                    if fields:
                        field_types = {'text': 0, 'checkbox': 0, 'radio': 0, 'other': 0}
                        for field_name, field_refs in fields.items():
                            field_key = list(field_refs.keys())[0]
                            field_ref = field_refs[field_key]
                            field = reader.get_object(field_ref)
                            
                            # Determine field type
                            if field.get("/FT") == "/Tx":  # Text
                                field_types['text'] += 1
                            elif field.get("/FT") == "/Btn":  # Button (checkbox or radio)
                                if field.get("/Ff", 0) & (1 << 15):  # Radio button
                                    field_types['radio'] += 1
                                else:  # Checkbox
                                    field_types['checkbox'] += 1
                            else:
                                field_types['other'] += 1
                                
                        surface_results['field_counts'] = field_types
                        surface_results['total_fields'] = sum(field_types.values())
                        
                        # Compare with expected field count
                        expected_fields = len(portfolio_data.get('fields', []))
                        if expected_fields != surface_results['total_fields']:
                            results['warnings'].append(
                                f"Field count mismatch: Expected {expected_fields}, found {surface_results['total_fields']}"
                            )
                    else:
                        results['errors'].append("Surface PDF has no form fields")
                        results['valid'] = False
                
                results['file_checks']['surface_file'] = surface_results
            except Exception as e:
                results['file_checks']['surface_file'] = {
                    'valid_pdf': False,
                    'error': str(e)
                }
                results['errors'].append(f"Surface file is not a valid PDF: {str(e)}")
                results['valid'] = False
        elif surface_file_path:
            results['errors'].append(f"Surface file not found: {surface_file_path}")
            results['valid'] = False
            results['file_checks']['surface_file'] = {'valid_pdf': False, 'exists': False}
            
        # Validate fields
        if 'fields' in portfolio_data:
            field_checks = {
                'count': len(portfolio_data['fields']),
                'by_type': {},
                'duplicate_names': [],
                'invalid_positions': []
            }
            
            # Count by type
            type_counts = {}
            field_names = set()
            duplicate_names = set()
            
            for field in portfolio_data['fields']:
                # Check field type
                field_type = field.get('type', 'unknown')
                type_counts[field_type] = type_counts.get(field_type, 0) + 1
                
                # Check for duplicate names
                name = field.get('name', '')
                if name in field_names:
                    duplicate_names.add(name)
                else:
                    field_names.add(name)
                    
                # Check field positions
                if field.get('x', 0) < 0 or field.get('y', 0) < 0:
                    field_checks['invalid_positions'].append({
                        'name': name,
                        'x': field.get('x', 0),
                        'y': field.get('y', 0)
                    })
                    results['warnings'].append(f"Field '{name}' has invalid position: ({field.get('x', 0)}, {field.get('y', 0)})")
            
            field_checks['by_type'] = type_counts
            field_checks['duplicate_names'] = list(duplicate_names)
            
            if duplicate_names:
                results['warnings'].append(f"Found {len(duplicate_names)} duplicate field names")
                
            results['field_checks'] = field_checks
            
        return results
    
    @staticmethod
    def test_form_filling(surface_file_path, test_data=None):
        """
        Test form filling with sample data
        
        Args:
            surface_file_path: Path to the surface PDF file
            test_data: Optional dictionary of field values for testing
            
        Returns:
            dict: Test results
        """
        results = {
            'timestamp': datetime.utcnow().isoformat(),
            'success': False,
            'errors': [],
            'warnings': [],
            'info': [],
            'filled_file': None,
            'performance': {}
        }
        
        if not os.path.exists(surface_file_path):
            results['errors'].append(f"Surface file not found: {surface_file_path}")
            return results
        
        try:
            # Get available fields
            available_fields = {}
            with open(surface_file_path, 'rb') as f:
                reader = PdfReader(f)
                pdf_fields = reader.get_fields()
                
                if not pdf_fields:
                    results['errors'].append("No form fields found in the PDF")
                    return results
                
                for field_name in pdf_fields:
                    field_key = list(pdf_fields[field_name].keys())[0]
                    field_ref = pdf_fields[field_name][field_key]
                    field = reader.get_object(field_ref)
                    
                    # Determine field type
                    if field.get("/FT") == "/Tx":  # Text
                        available_fields[field_name] = {'type': 'text', 'test_value': f"Test value for {field_name}"}
                    elif field.get("/FT") == "/Btn":  # Button (checkbox or radio)
                        if field.get("/Ff", 0) & (1 << 15):  # Radio button
                            available_fields[field_name] = {'type': 'radio', 'test_value': "Yes"}
                        else:  # Checkbox
                            available_fields[field_name] = {'type': 'checkbox', 'test_value': True}
            
            # Generate test data if not provided
            if not test_data:
                test_data = {field: info['test_value'] for field, info in available_fields.items()}
                
            # Measure fill performance
            start_time = time.time()
            
            # Create temp output file
            temp_output = os.path.join(os.path.dirname(surface_file_path), f"test_filled_{datetime.now().strftime('%Y%m%d%H%M%S')}.pdf")
            
            # Fill the form
            filled_path = surface_pdf_generator.fill_surface_pdf(surface_file_path, test_data, temp_output)
            
            end_time = time.time()
            fill_time = end_time - start_time
            
            # Verify filled form
            with open(filled_path, 'rb') as f:
                reader = PdfReader(f)
                filled_fields = reader.get_fields()
                
                # Check that fields were filled
                fields_filled = 0
                for field_name, field_refs in filled_fields.items():
                    if field_name in test_data:
                        field_key = list(field_refs.keys())[0]
                        field_ref = field_refs[field_key]
                        field = reader.get_object(field_ref)
                        
                        if "/V" in field:
                            fields_filled += 1
                
                results['info'].append(f"Filled {fields_filled} out of {len(test_data)} fields")
                
                if fields_filled < len(test_data):
                    results['warnings'].append(f"Not all fields were filled: {fields_filled}/{len(test_data)}")
            
            # Record results
            results['success'] = True
            results['filled_file'] = filled_path
            results['performance'] = {
                'fill_time_seconds': fill_time,
                'fields_per_second': len(test_data) / fill_time if fill_time > 0 else 0
            }
            
        except Exception as e:
            results['errors'].append(f"Error testing form filling: {str(e)}")
            
        return results


# Create a global diagnostics instance
pdf_diagnostics = PDFPortfolioDiagnostics()
