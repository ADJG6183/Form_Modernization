"""
API routes for error logging
"""
import os
import json
import datetime
import traceback
from flask import Blueprint, request, jsonify, current_app

# Create a Blueprint for error logging API
error_logging_api = Blueprint('error_logging', __name__, url_prefix='/api')

@error_logging_api.route('/log-error', methods=['POST'])
def log_client_error():
    """Log client-side errors for debugging"""
    try:
        data = request.json
        if not data or 'error_type' not in data or 'error_data' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required error data'
            }), 400
        
        error_type = data['error_type']
        error_data = data['error_data']
        
        # Create a timestamp-based filename
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        log_dir = os.path.join(current_app.root_path, 'logs')
        
        # Create logs directory if it doesn't exist
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        # Create log file with detailed information
        log_file = os.path.join(log_dir, f"{error_type}_{timestamp}.json")
        
        with open(log_file, 'w') as f:
            json.dump(error_data, f, indent=2)
            
        current_app.logger.error(f"Client error logged: {error_type} - {error_data.get('error', 'Unknown error')}")
        
        return jsonify({
            'success': True,
            'message': 'Error logged successfully'
        })
        
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error logging client error: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': f'Server error logging client error: {str(e)}'
        }), 500
