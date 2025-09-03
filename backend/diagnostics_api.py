"""
PDF Portfolio Diagnostics API

This module provides API endpoints for PDF portfolio diagnostics and testing.
"""
import os
import sys
import traceback
import logging
import time
from datetime import datetime
from io import BytesIO
from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify, send_file, current_app, session
from functools import wraps

# Create a Blueprint for diagnostics
diagnostics_api = Blueprint('diagnostics', __name__, url_prefix='/diagnostics')

# Import our diagnostics utilities
try:
    from pdf_portfolio_diagnostics import pdf_diagnostics
except ImportError:
    # Create a placeholder if module not found
    class PlaceholderDiagnostics:
        @staticmethod
        def validate_portfolio(*args, **kwargs):
            return {"error": "Diagnostics module not available"}
            
        @staticmethod
        def test_form_filling(*args, **kwargs):
            return {"error": "Diagnostics module not available"}
            
    pdf_diagnostics = PlaceholderDiagnostics()
    logging.warning("pdf_portfolio_diagnostics module not found")

@diagnostics_api.route('/test-pdf/<int:portfolio_id>', methods=['GET'])
def test_pdf(portfolio_id):
    """Test PDF loading for a specific portfolio"""
    try:
        # Import db from app context
        from app import db, login_required, File, CreatedFile, PDFPortfolio
        
        # Look up the portfolio
        portfolio = PDFPortfolio.query.get_or_404(portfolio_id)
        
        # Get surface file
        if not portfolio.surface_file_id:
            return jsonify({
                'success': False,
                'error': 'No surface file found for this portfolio'
            }), 404
            
        surface_file = CreatedFile.query.get_or_404(portfolio.surface_file_id)
        
        # Create HTML with test results
        file_exists = os.path.exists(surface_file.file_path)
        file_size = os.path.getsize(surface_file.file_path) if file_exists else 0
        
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>PDF Test Results</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .success {{ color: green; }}
                .error {{ color: red; }}
                pre {{ background: #f0f0f0; padding: 10px; overflow-x: auto; }}
                table {{ border-collapse: collapse; }}
                th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
                th {{ background-color: #f2f2f2; }}
                iframe {{ width: 100%; height: 600px; border: 1px solid #ddd; }}
            </style>
        </head>
        <body>
            <h1>PDF Test Results</h1>
            
            <h2>Portfolio Information</h2>
            <table>
                <tr>
                    <th>Field</th>
                    <th>Value</th>
                </tr>
                <tr>
                    <td>Portfolio ID</td>
                    <td>{portfolio.id}</td>
                </tr>
                <tr>
                    <td>Base File ID</td>
                    <td>{portfolio.base_file_id}</td>
                </tr>
                <tr>
                    <td>Surface File ID</td>
                    <td>{portfolio.surface_file_id}</td>
                </tr>
                <tr>
                    <td>Surface File Path</td>
                    <td>{surface_file.file_path}</td>
                </tr>
                <tr>
                    <td>File Exists</td>
                    <td class="{'success' if file_exists else 'error'}">{file_exists}</td>
                </tr>
                <tr>
                    <td>File Size</td>
                    <td>{file_size} bytes</td>
                </tr>
            </table>
            
            <h2>File Preview</h2>
            <p>If the PDF displays correctly below, the problem is likely with the frontend PDF loading.</p>
            <iframe src="/api/portfolio/{portfolio_id}/surface-file"></iframe>
            
            <h2>Direct Link</h2>
            <p><a href="/api/portfolio/{portfolio_id}/surface-file" target="_blank">Open PDF directly</a></p>
        </body>
        </html>
        """
        
        return html
        
    except Exception as e:
        tb = traceback.format_exc()
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>PDF Test Error</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .error {{ color: red; }}
                pre {{ background: #f0f0f0; padding: 10px; overflow-x: auto; }}
            </style>
        </head>
        <body>
            <h1>PDF Test Error</h1>
            
            <p class="error">Error: {str(e)}</p>
            
            <h2>Stack Trace</h2>
            <pre>{tb}</pre>
        </body>
        </html>
        """

@diagnostics_api.route('/portfolio/<int:portfolio_id>/validate', methods=['GET'])
def validate_portfolio(portfolio_id):
    """
    Run diagnostics on a PDF portfolio
    
    Args:
        portfolio_id: ID of the portfolio to diagnose
    """
    try:
        # Check for user session
        if 'user_email' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'}), 401
        
        # Import models here to avoid circular imports
        from app import PDFPortfolio, CreatedFile, File, PDFFormField
        
        # Get the portfolio
        portfolio = PDFPortfolio.query.get(portfolio_id)
        if not portfolio:
            return jsonify({'success': False, 'error': 'Portfolio not found'}), 404
            
        # Security check - only the owner can run diagnostics
        if portfolio.user_email != session.get('user_email', ''):
            return jsonify({'success': False, 'error': 'Unauthorized access'}), 403
        
        # Get the base and surface files
        base_file = File.query.get(portfolio.base_file_id)
        surface_file = CreatedFile.query.get(portfolio.surface_file_id)
        
        if not base_file or not surface_file:
            return jsonify({
                'success': False, 
                'error': 'Missing required files',
                'details': {
                    'base_file_exists': base_file is not None,
                    'surface_file_exists': surface_file is not None
                }
            }), 404
        
        # Prepare portfolio data for validation
        portfolio_data = {
            'id': portfolio.id,
            'name': portfolio.name,
            'base_file_id': portfolio.base_file_id,
            'surface_file_id': portfolio.surface_file_id,
            'fields': []
        }
        
        # Add fields from database
        fields = PDFFormField.query.filter_by(form_id=portfolio.form_definition_id).all() if portfolio.form_definition_id else []
        for field in fields:
            portfolio_data['fields'].append({
                'name': field.name,
                'type': field.field_type,
                'x': field.x,
                'y': field.y,
                'width': field.width,
                'height': field.height,
                'page': field.page,
                'default_value': field.default_value
            })
        
        # Run the diagnostics
        results = pdf_diagnostics.validate_portfolio(
            portfolio_data=portfolio_data,
            base_file_path=base_file.file_path,
            surface_file_path=surface_file.file_path
        )
        
        # Add summary information
        results['summary'] = {
            'portfolio_id': portfolio.id,
            'portfolio_name': portfolio.name,
            'field_count': len(portfolio_data['fields']),
            'base_file_name': base_file.original_filename,
            'surface_file_name': surface_file.original_filename
        }
        
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logging.error(f"Error running portfolio diagnostics: {str(e)}")
        logging.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

@diagnostics_api.route('/test-form-fill/<int:portfolio_id>', methods=['POST'])
def test_form_fill(portfolio_id):
    """
    Test form filling for a PDF portfolio
    
    Args:
        portfolio_id: ID of the portfolio to test
    """
    try:
        # Check for user session
        if 'user_email' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'}), 401
            
        # Import models here to avoid circular imports
        from app import PDFPortfolio, CreatedFile
        
        # Get the portfolio
        portfolio = PDFPortfolio.query.get(portfolio_id)
        if not portfolio:
            return jsonify({'success': False, 'error': 'Portfolio not found'}), 404
            
        # Security check - only the owner can run tests
        if portfolio.user_email != session.get('user_email', ''):
            return jsonify({'success': False, 'error': 'Unauthorized access'}), 403
            
        # Get the surface file
        surface_file = CreatedFile.query.get(portfolio.surface_file_id)
        if not surface_file:
            return jsonify({'success': False, 'error': 'Surface file not found'}), 404
            
        # Get test data from request, if any
        test_data = request.json.get('test_data') if request.json else None
        
        # Run the test
        results = pdf_diagnostics.test_form_filling(
            surface_file_path=surface_file.file_path,
            test_data=test_data
        )
        
        # Add summary information
        results['summary'] = {
            'portfolio_id': portfolio.id,
            'portfolio_name': portfolio.name,
            'surface_file_name': surface_file.original_filename
        }
        
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logging.error(f"Error testing form filling: {str(e)}")
        logging.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

@diagnostics_api.route('/system-info', methods=['GET'])
def get_system_info():
    """Get system diagnostic information"""
    try:
        # Check for user session
        if 'user_email' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'}), 401
            
        import platform
        import sys
        import pkg_resources
        
        # Get Python packages
        packages = [
            {'name': p.project_name, 'version': p.version}
            for p in pkg_resources.working_set
        ]
        
        # Filter for relevant packages
        pdf_packages = [p for p in packages if any(
            pdf_lib in p['name'].lower() for pdf_lib in 
            ['pdf', 'pypdf', 'pypdf2', 'reportlab', 'pdfform']
        )]
        
        # Get system info
        system_info = {
            'platform': platform.platform(),
            'python_version': sys.version,
            'packages': pdf_packages,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return jsonify({
            'success': True,
            'system_info': system_info
        })
        
    except Exception as e:
        logging.error(f"Error getting system info: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500
