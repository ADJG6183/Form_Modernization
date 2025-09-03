"""
API routes for error logging
"""
import os
import json
import uuid
import datetime
import traceback
from flask import Blueprint, request, jsonify, current_app, session

# Create a Blueprint for error logging API
error_logging_api = Blueprint('error_logging', __name__, url_prefix='/api')

def ensure_log_directory():
    """Ensure the log directory exists"""
    log_dir = os.path.join(current_app.root_path, 'logs')
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    return log_dir

def sanitize_error_data(data):
    """
    Sanitize error data to remove sensitive information
    
    Args:
        data: The error data dictionary
        
    Returns:
        dict: Sanitized error data
    """
    # Make a copy to avoid modifying the original
    sanitized = data.copy() if isinstance(data, dict) else {'error': str(data)}
    
    # Remove sensitive information
    for key in list(sanitized.keys()):
        if key.lower() in ('password', 'token', 'key', 'secret', 'auth'):
            sanitized[key] = '[REDACTED]'
    
    return sanitized

@error_logging_api.route('/error-log', methods=['POST'])
def log_client_error():
    """Log client-side errors for debugging"""
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': 'Missing error data'
            }), 400
        
        # Generate a unique ID for this error
        error_id = str(uuid.uuid4())
        
        # Add additional context
        context = {
            'timestamp': datetime.datetime.now().isoformat(),
            'user_email': session.get('user_email', 'anonymous'),
            'ip_address': request.remote_addr,
            'user_agent': request.user_agent.string,
            'path': request.path,
            'method': request.method,
            'error_id': error_id
        }
        
        # Combine data and context
        log_data = {
            'error': sanitize_error_data(data),
            'context': context
        }
        
        # Create log directory if needed
        log_dir = ensure_log_directory()
        
        # Create log file with unique ID
        log_file = os.path.join(log_dir, f"client_error_{error_id}.json")
        
        # Write error data to file
        with open(log_file, 'w') as f:
            json.dump(log_data, f, indent=2)
        
        # Log to application logger
        error_type = data.get('type', 'unknown')
        error_message = data.get('message', 'No message provided')
        current_app.logger.error(f"Client error [{error_id}]: {error_type} - {error_message}")
        
        return jsonify({
            'success': True,
            'message': 'Error logged successfully',
            'error_id': error_id
        })
        
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error in error logging API: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': f"Server error in error logging: {str(e)}"
        }), 500
