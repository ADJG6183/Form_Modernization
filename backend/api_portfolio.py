"""
API routes for handling PDF Portfolio requests
"""
import os
import traceback
from flask import Blueprint, send_file, jsonify, abort, current_app, session, g
from functools import wraps
from app import login_required, File, CreatedFile, PDFPortfolio

# Create a Blueprint for portfolio API routes
portfolio_api = Blueprint('portfolio_api', __name__, url_prefix='/api/portfolio')

@portfolio_api.route('/<int:portfolio_id>/surface-file', methods=['GET'])
@login_required
def get_surface_file(portfolio_id):
    """Get the surface file for a given portfolio ID"""
    # Log the request
    current_app.logger.debug(f"Surface file requested for portfolio ID: {portfolio_id}")
    
    try:
        # Import db from app context to ensure proper registration
        from app import db
        
        # Look up the portfolio
        portfolio = PDFPortfolio.query.get_or_404(portfolio_id)
        current_app.logger.debug(f"Portfolio found: {portfolio.id}")
        
        # Make sure we have a surface file ID
        if not portfolio.surface_file_id:
            current_app.logger.warning(f"No surface file ID for portfolio {portfolio_id}")
            return jsonify({
                'success': False,
                'error': 'No surface file exists for this portfolio'
            }), 404
        
        current_app.logger.debug(f"Surface file ID: {portfolio.surface_file_id}")
        
        # Get the surface file
        surface_file = CreatedFile.query.get_or_404(portfolio.surface_file_id)
        current_app.logger.debug(f"Surface file found: {surface_file.id}, path: {surface_file.file_path}")
        
        # Security check: file owner should match the logged-in user
        if surface_file.user_email != session.get('user_email'):
            current_app.logger.warning(f"Access denied: User {session.get('user_email')} attempted to access file owned by {surface_file.user_email}")
            return abort(403)
        
        # Check that file exists
        file_path = surface_file.file_path
        if not os.path.exists(file_path):
            current_app.logger.warning(f"Surface file not found on disk: {file_path}")
            return jsonify({
                'success': False,
                'error': 'Surface file not found on server'
            }), 404
            
        current_app.logger.debug(f"Serving surface file from: {file_path}")
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error getting surface file: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': f'Error retrieving surface file: {str(e)}'
        }), 500
    
    # Stream the file
    try:
        # Debug info
        current_app.logger.debug(f"Attempting to send file {file_path} using send_file")
        
        # Check file exists and is accessible
        if not os.path.isfile(file_path):
            current_app.logger.error(f"File not found or not accessible: {file_path}")
            
            # Check if directory exists
            dir_path = os.path.dirname(file_path)
            if not os.path.isdir(dir_path):
                current_app.logger.error(f"Directory does not exist: {dir_path}")
                return jsonify({
                    'success': False,
                    'error': f'Surface file directory not found on the server: {dir_path}'
                }), 404
                
            # List directory contents for debugging
            try:
                dir_contents = os.listdir(dir_path)
                current_app.logger.debug(f"Directory contents of {dir_path}: {dir_contents}")
            except Exception as e:
                current_app.logger.error(f"Error listing directory: {str(e)}")
                
            return jsonify({
                'success': False,
                'error': 'Surface file could not be accessed on the server'
            }), 404
            
        # Get file size for logging
        file_size = os.path.getsize(file_path)
        current_app.logger.debug(f"File size: {file_size} bytes")
            
        # Stream the file
        return send_file(
            file_path,
            mimetype='application/pdf',
            as_attachment=False,
            download_name=surface_file.original_filename
        )
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error sending file: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': f'Error sending file: {str(e)}'
        }), 500

@portfolio_api.route('/<int:portfolio_id>/info', methods=['GET'])
@login_required
def get_portfolio_info(portfolio_id):
    """Get information about a portfolio"""
    try:
        # Import db from app context to ensure proper registration
        from app import db
        
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
