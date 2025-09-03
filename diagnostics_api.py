"""
API routes for system diagnostics
"""
import os
import json
import traceback
from flask import Blueprint, request, jsonify, current_app, session
from functools import wraps

# Create a Blueprint for diagnostics API
diagnostics_api = Blueprint('diagnostics', __name__, url_prefix='/api/diagnostics')

def require_login(f):
    """Ensure user is logged in"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_email' not in session:
            return jsonify({
                'success': False,
                'error': 'Authentication required'
            }), 401
        return f(*args, **kwargs)
    return decorated_function

@diagnostics_api.route('/report', methods=['POST'])
@require_login
def report_diagnostics():
    """Save diagnostic information"""
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': 'Missing diagnostic data'
            }), 400
        
        # Generate a reference ID for this report
        from uuid import uuid4
        reference_id = str(uuid4())
        
        # Add metadata
        data['metadata'] = {
            'user_email': session.get('user_email', 'unknown'),
            'timestamp': str(current_app.datetime.utcnow()),
            'reference_id': reference_id,
            'remote_ip': request.remote_addr,
            'user_agent': request.user_agent.string
        }
        
        # Save to diagnostics file
        diagnostics_dir = os.path.join(current_app.root_path, 'logs', 'diagnostics')
        os.makedirs(diagnostics_dir, exist_ok=True)
        
        diagnostics_file = os.path.join(diagnostics_dir, f"{reference_id}.json")
        with open(diagnostics_file, 'w') as f:
            json.dump(data, f, indent=2)
            
        current_app.logger.info(f"Diagnostic report saved: {reference_id}")
        
        return jsonify({
            'success': True,
            'reference_id': reference_id,
            'message': 'Diagnostic information saved'
        })
        
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error saving diagnostics: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@diagnostics_api.route('/system-info', methods=['GET'])
@require_login
def get_system_info():
    """Get basic system information"""
    try:
        from app import db
        
        # Import system modules
        import platform
        import sys
        from datetime import datetime
        
        # Check database connection
        db_status = "ok"
        try:
            db.session.execute("SELECT 1")
        except Exception as e:
            db_status = f"error: {str(e)}"
        
        # Get uploaded files count
        from app import File
        files_count = File.query.count()
        
        # Get created files count
        from app import CreatedFile
        created_files_count = CreatedFile.query.count()
        
        # Get portfolios count
        from app import PDFPortfolio
        portfolios_count = PDFPortfolio.query.count()
        
        # Get submissions count
        from app import Submission
        submissions_count = Submission.query.count()
        
        # System information
        system_info = {
            'server_time': str(datetime.now()),
            'python_version': sys.version,
            'platform': platform.platform(),
            'database': {
                'status': db_status,
                'counts': {
                    'files': files_count,
                    'created_files': created_files_count,
                    'portfolios': portfolios_count,
                    'submissions': submissions_count
                }
            },
            'app_info': {
                'debug_mode': current_app.debug,
                'root_path': current_app.root_path,
                'url_map_size': len(list(current_app.url_map.iter_rules()))
            }
        }
        
        return jsonify({
            'success': True,
            'system_info': system_info
        })
        
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error getting system info: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@diagnostics_api.route('/test-portfolio/<int:portfolio_id>', methods=['GET'])
@require_login
def test_portfolio(portfolio_id):
    """Test portfolio API and access"""
    try:
        from app import PDFPortfolio, File, CreatedFile
        
        results = {
            'portfolio_found': False,
            'base_file_found': False,
            'surface_file_found': False,
            'base_file_exists': False,
            'surface_file_exists': False,
            'permissions_valid': False
        }
        
        # Get portfolio
        portfolio = PDFPortfolio.query.get(portfolio_id)
        if not portfolio:
            return jsonify({
                'success': False,
                'message': f'Portfolio not found: {portfolio_id}',
                'results': results
            })
        
        results['portfolio_found'] = True
        results['portfolio_user'] = portfolio.user_email
        results['permissions_valid'] = portfolio.user_email == session.get('user_email')
        
        # Check if user is authorized
        if not results['permissions_valid']:
            return jsonify({
                'success': False,
                'message': 'Unauthorized access',
                'results': results
            }), 403
        
        # Get base file
        base_file = File.query.get(portfolio.base_file_id)
        if base_file:
            results['base_file_found'] = True
            results['base_file_path'] = base_file.file_path
            results['base_file_exists'] = os.path.exists(base_file.file_path)
        
        # Get surface file
        surface_file = CreatedFile.query.get(portfolio.surface_file_id) if portfolio.surface_file_id else None
        if surface_file:
            results['surface_file_found'] = True
            results['surface_file_path'] = surface_file.file_path
            results['surface_file_exists'] = os.path.exists(surface_file.file_path)
        
        # Additional info
        results['portfolio_status'] = portfolio.status
        results['portfolio_created'] = str(portfolio.created_at)
        results['portfolio_updated'] = str(portfolio.updated_at)
        
        # Get submissions
        from app import Submission
        submissions = Submission.query.filter_by(portfolio_id=portfolio_id).count()
        results['submission_count'] = submissions
        
        return jsonify({
            'success': True,
            'message': 'Portfolio tests completed',
            'results': results
        })
        
    except Exception as e:
        tb = traceback.format_exc()
        current_app.logger.error(f"Error testing portfolio: {str(e)}\n{tb}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
