"""
API routes for handling PDF Portfolio requests
"""
import os
import traceback
import logging
import sys
import uuid
from flask import Blueprint, send_file, jsonify, abort, current_app, session, g
from functools import wraps

# Add the parent directory to sys.path to ensure imports work correctly
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Create a Blueprint for portfolio API routes
portfolio_api = Blueprint('portfolio_api', __name__, url_prefix='/api/portfolio')

# Helper functions for common operations
def get_portfolio_with_validation(portfolio_id):
    """
    Get a portfolio with validation and proper error handling
    
    Args:
        portfolio_id: ID of the portfolio to retrieve
        
    Returns:
        portfolio: The portfolio object if found and validated
        
    Raises:
        HTTPException: 404 if not found, 403 if unauthorized
    """
    from app import PDFPortfolio
    
    # Look up the portfolio
    portfolio = PDFPortfolio.query.get(portfolio_id)
    if not portfolio:
        current_app.logger.warning(f"Portfolio not found: {portfolio_id}")
        abort(404, description="Portfolio not found")
        
    # Security check: portfolio owner should match the logged-in user
    if portfolio.user_email != session.get('user_email'):
        current_app.logger.warning(f"Access denied: User {session.get('user_email')} attempted to access portfolio owned by {portfolio.user_email}")
        abort(403, description="You don't have permission to access this portfolio")
        
    return portfolio

def get_file_with_validation(file_id, file_type=None):
    """
    Get a file with validation and proper error handling
    
    Args:
        file_id: ID of the file to retrieve
        file_type: Optional type of file to check ("File", "CreatedFile")
        
    Returns:
        file: The file object if found and validated
        
    Raises:
        HTTPException: 404 if not found, 403 if unauthorized
    """
    from app import File, CreatedFile, FilledForm
    
    file = None
    if file_type == "File" or file_type is None:
        file = File.query.get(file_id)
    
    if (file_type == "CreatedFile" or file_type is None) and not file:
        file = CreatedFile.query.get(file_id)
    
    if (file_type == "FilledForm" or file_type is None) and not file:
        file = FilledForm.query.get(file_id)
    
    if not file:
        current_app.logger.warning(f"File not found: {file_id}, type: {file_type}")
        abort(404, description="File not found")
    
    # Security check: file owner should match the logged-in user
    if file.user_email != session.get('user_email'):
        current_app.logger.warning(f"Access denied: User {session.get('user_email')} attempted to access file owned by {file.user_email}")
        abort(403, description="You don't have permission to access this file")
        
    # Check that file exists on disk
    if not os.path.exists(file.file_path):
        current_app.logger.warning(f"File not found on disk: {file.file_path}")
        
        # List directory contents for debugging
        try:
            dir_path = os.path.dirname(file.file_path)
            if os.path.exists(dir_path):
                dir_contents = os.listdir(dir_path)
                current_app.logger.debug(f"Directory contents of {dir_path}:")
                for item in dir_contents:
                    current_app.logger.debug(f"  {item}")
            else:
                current_app.logger.debug(f"Directory does not exist: {dir_path}")
        except Exception as e:
            current_app.logger.error(f"Error listing directory: {str(e)}")
        
        abort(404, description="File not found on server")
        
    return file

# Portfolio API routes
@portfolio_api.route('/<int:portfolio_id>/surface-file', methods=['GET'])
@portfolio_api.route('/<int:portfolio_id>/surface', methods=['GET'])  # Alternate, cleaner URL
def get_surface_file(portfolio_id):
    """Get the surface file for a given portfolio ID"""
    # Log the request
    current_app.logger.debug(f"Surface file requested for portfolio ID: {portfolio_id}")
    
    try:
        # Check if user is logged in
        if not session.get('user_email'):
            return jsonify({'error': 'Authentication required'}), 401
        
        # Import dependencies from app
        try:
            from app import PDFPortfolio, CreatedFile
        except ImportError as e:
            current_app.logger.error(f"Import error: {str(e)}")
            return jsonify({'error': 'Server configuration error'}), 500
        
        # Get and validate the portfolio
        portfolio = get_portfolio_with_validation(portfolio_id)
        
        # Make sure we have a surface file ID
        if not portfolio.surface_file_id:
            current_app.logger.warning(f"No surface file ID for portfolio {portfolio_id}")
            return jsonify({
                'success': False,
                'error': 'No surface file exists for this portfolio'
            }), 404
        
        current_app.logger.debug(f"Surface file ID: {portfolio.surface_file_id}")
        
        # Get and validate the surface file
        surface_file = get_file_with_validation(portfolio.surface_file_id, "CreatedFile")
        
        # Serve the file with cache control headers to prevent caching issues
        response = send_file(
            surface_file.file_path,
            mimetype="application/pdf",
            as_attachment=False
        )
        
        # Set cache control headers
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        
        # Add ETag with file timestamp for cache validation
        try:
            file_timestamp = str(int(os.path.getmtime(surface_file.file_path)))
            response.headers['ETag'] = f'"{file_timestamp}-{surface_file.id}"'
        except Exception:
            # Fallback if we can't get the file timestamp
            import uuid
            response.headers['ETag'] = f'"{uuid.uuid4()}"'
        
        current_app.logger.debug(f"Surface file served successfully: {surface_file.file_path}")
        return response
        
    except Exception as e:
        current_app.logger.error(f"Error serving surface file: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f"Error serving surface file: {str(e)}"
        }), 500

@portfolio_api.route('/<int:portfolio_id>/info', methods=['GET'])
def get_portfolio_info(portfolio_id):
    """Get portfolio information"""
    # Import login_required from app and apply manually to prevent circular imports
    try:
        from app import login_required, PDFPortfolio, File, CreatedFile
        
        # Security check - ensure user is logged in
        if not session.get('user_email'):
            return jsonify({'error': 'Authentication required'}), 401
    except ImportError as e:
        current_app.logger.error(f"Import error in portfolio_api: {str(e)}")
        return jsonify({'error': 'Server configuration error'}), 500
def get_portfolio_info(portfolio_id):
    """Get information about a portfolio"""
    try:
        # Import db, PDFPortfolio, File, CreatedFile from app context to ensure proper registration
        from app import db, PDFPortfolio, File, CreatedFile
        
        # Look up the portfolio
        portfolio = PDFPortfolio.query.get_or_404(portfolio_id)
        
        # Get associated files
        base_file = File.query.get(portfolio.base_file_id)
        surface_file = None
        if portfolio.surface_file_id:
            surface_file = CreatedFile.query.get(portfolio.surface_file_id)
            
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error getting portfolio info: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': f'Error retrieving portfolio information: {str(e)}'
        }), 500
    
    # Return portfolio data
    return jsonify({
        'success': True,
        'portfolio': {
            'id': portfolio.id,
            'created_at': portfolio.created_at.isoformat() if portfolio.created_at else None,
            'updated_at': portfolio.updated_at.isoformat() if portfolio.updated_at else None,
            'base_file': {
                'id': base_file.id,
                'name': base_file.original_filename
            } if base_file else None,
            'surface_file': {
                'id': surface_file.id,
                'name': surface_file.original_filename
            } if surface_file else None
        }
    })
