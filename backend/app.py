import subprocess
from flask import Flask, request, send_file, render_template, jsonify, url_for, redirect, flash, session
from functools import wraps
import os
import uuid
import traceback
import logging
import hashlib
import time
import json
from io import BytesIO
from docx2pdf import convert
import pythoncom  # This is Windows-specific and required for docx2pdf
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from datetime import datetime
from werkzeug.utils import secure_filename
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.acroform import AcroForm
from flask import send_from_directory
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject, create_string_object, BooleanObject
import json
# Import PdfWrapper from PyPDFForm for form field handling
from PyPDFForm import PdfWrapper

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = 'your-temporary-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///files.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Custom filters
@app.template_filter('hash')
def hash_filter(value):
    """Generate a hash from a string value."""
    if value is None:
        return 0
    return int(hashlib.md5(str(value).encode()).hexdigest(), 16) % 10000

# File model: for uploaded documents
class File(db.Model):
    __tablename__ = 'files'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(10), nullable=False)
    upload_date = db.Column(db.DateTime, default=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(512), nullable=False)
    def __init__(self, filename, original_filename, file_type, file_path, user_email):
        self.filename = filename
        self.original_filename = original_filename
        self.file_type = file_type
        self.file_path = file_path
        self.user_email = user_email

# CreatedFile model: for files saved from the PDF editor
class CreatedFile(db.Model):
    __tablename__ = 'created_files'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(10), nullable=False)
    upload_date = db.Column(db.DateTime, default=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(512), nullable=False)
    original_file_id = db.Column(db.Integer, nullable=True)  # ID of the original file used to create this file
    def __init__(self, filename, original_filename, file_type, file_path, user_email, original_file_id=None):
        self.filename = filename
        self.original_filename = original_filename
        self.file_type = file_type
        self.file_path = file_path
        self.user_email = user_email
        self.original_file_id = original_file_id

# FilledForm model: for storing filled PDFs
class FilledForm(db.Model):
    __tablename__ = 'filled_forms'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(10), nullable=False)
    filled_date = db.Column(db.DateTime, default=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(512), nullable=False)
    source_file_id = db.Column(db.Integer, nullable=False)  # ID of the original form that was filled
    form_data = db.Column(db.Text, nullable=True)  # JSON string of form field data
    form_status = db.Column(db.String(20), nullable=False, default='completed')  # Status: draft, completed, submitted
    field_count = db.Column(db.Integer, nullable=True)  # Number of fields in the form
    modified_date = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __init__(self, filename, original_filename, file_type, file_path, user_email, source_file_id, form_data=None, form_status='completed'):
        self.filename = filename
        self.original_filename = original_filename
        self.file_type = file_type
        self.file_path = file_path
        self.user_email = user_email
        self.source_file_id = source_file_id
        self.form_data = form_data
        self.form_status = form_status
    
    def get_field_values(self):
        if not self.form_data:
            return {}
        try:
            return json.loads(self.form_data)
        except:
            return {}
    
    def to_dict(self):
        return {
            'id': self.id,
            'filename': self.filename,
            'original_filename': self.original_filename,
            'file_type': self.file_type,
            'filled_date': self.filled_date.strftime('%Y-%m-%d %H:%M:%S'),
            'user_email': self.user_email,
            'source_file_id': self.source_file_id,
            'field_count': self.field_count,
            'form_status': self.form_status,
            'modified_date': self.modified_date.strftime('%Y-%m-%d %H:%M:%S')
        }

# FormDefinition model: for storing JSON-schema form definitions
class FormDefinition(db.Model):
    __tablename__ = 'form_definitions'
    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, nullable=False)  # Reference to the original File
    schema = db.Column(db.Text, nullable=False)  # Stored as JSON text
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    
    def __init__(self, file_id, schema, user_email):
        self.file_id = file_id
        self.schema = json.dumps(schema) if isinstance(schema, dict) else schema
        self.user_email = user_email
    
    def get_schema(self):
        """Get schema as a Python dictionary"""
        if not self.schema:
            return {"fields": []}
            
        try:
            return json.loads(self.schema)
        except Exception:
            return {"fields": []}
    
    def to_dict(self):
        """Convert model to dictionary for API responses"""
        return {
            'id': self.id,
            'file_id': self.file_id,
            'schema': self.get_schema(),
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S'),
            'user_email': self.user_email
        }

# New model for PDF form fields using PyPDFForm
class PDFFormField(db.Model):
    __tablename__ = 'pdf_form_fields'
    id = db.Column(db.Integer, primary_key=True)
    form_id = db.Column(db.Integer, nullable=False)  # Reference to FormDefinition
    name = db.Column(db.String(255), nullable=False)
    field_type = db.Column(db.String(50), nullable=False)  # text, checkbox, signature, etc.
    x = db.Column(db.Float, nullable=False)
    y = db.Column(db.Float, nullable=False)
    width = db.Column(db.Float, nullable=False)
    height = db.Column(db.Float, nullable=False)
    page = db.Column(db.Integer, nullable=False, default=0)
    default_value = db.Column(db.String(255), nullable=True)
    font_size = db.Column(db.Float, nullable=True)
    font_name = db.Column(db.String(50), nullable=True)
    text_color = db.Column(db.String(20), nullable=True)
    format = db.Column(db.String(50), nullable=True)  # date, number, text
    read_only = db.Column(db.Boolean, nullable=False, default=False)
    required = db.Column(db.Boolean, nullable=False, default=False)
    
    def __init__(self, form_id, name, field_type, x, y, width, height, page=0,
                default_value=None, font_size=None, font_name=None, text_color=None,
                format=None, read_only=False, required=False):
        self.form_id = form_id
        self.name = name
        self.field_type = field_type
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.page = page
        self.default_value = default_value
        self.font_size = font_size
        self.font_name = font_name
        self.text_color = text_color
        self.format = format
        self.read_only = read_only
        self.required = required
    
    def to_dict(self):
        """Convert field to dictionary for JSON schema"""
        return {
            'id': self.id,
            'name': self.name,
            'type': self.field_type,
            'x': self.x,
            'y': self.y,
            'width': self.width,
            'height': self.height,
            'page': self.page,
            'default_value': self.default_value,
            'font_size': self.font_size,
            'font_name': self.font_name,
            'text_color': self.text_color,
            'format': self.format,
            'read_only': self.read_only,
            'required': self.required
        }

# New model for PDF Portfolio approach
class PDFPortfolio(db.Model):
    """
    Links base PDFs (original uploads) to surface PDFs (generated with AcroForm fields)
    """
    __tablename__ = 'pdf_portfolios'
    id = db.Column(db.Integer, primary_key=True)
    base_file_id = db.Column(db.Integer, nullable=False)  # ID of original uploaded PDF
    surface_file_id = db.Column(db.Integer, nullable=True)  # ID of generated surface PDF with fields
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='active')  # active, archived
    
    def __init__(self, base_file_id, user_email, surface_file_id=None, status='active'):
        self.base_file_id = base_file_id
        self.surface_file_id = surface_file_id
        self.user_email = user_email
        self.status = status

# Model for submissions (filled form data)
class Submission(db.Model):
    """
    Stores form submissions with metadata and field values
    """
    __tablename__ = 'submissions'
    id = db.Column(db.Integer, primary_key=True)
    portfolio_id = db.Column(db.Integer, nullable=True)  # Add this line
    filled_file_id = db.Column(db.Integer, nullable=True)  # ID of filled surface PDF
    form_data = db.Column(db.Text, nullable=False)  # JSON string of form field values
    form_metadata = db.Column(db.Text, nullable=True)  # JSON string of PDF metadata (renamed from metadata)
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_email = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='submitted')  # draft, submitted, processed
    
    def __init__(self, portfolio_id, user_email, filled_file_id=None, form_metadata=None, status='submitted'):
        self.portfolio_id = portfolio_id
        self.filled_file_id = filled_file_id
        self.user_email = user_email
        self.status = status
        self.form_metadata = json.dumps(form_metadata) if isinstance(form_metadata, dict) else form_metadata
    
    def get_form_data(self):
        """Get form data as a Python dictionary"""
        if not self.form_data:
            return {}
        try:
            return json.loads(self.form_data)
        except:
            return {}
    
    def get_form_metadata(self):
        """Get form metadata as a Python dictionary"""
        if not self.form_metadata:
            return {}
        try:
            return json.loads(self.form_metadata)
        except:
            return {}

# Define upload folder configuration
UPLOAD_FOLDER_UPLOADED = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'uploaded')
UPLOAD_FOLDER_CREATED = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'created')
UPLOAD_FOLDER_FILLED = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'filled')
os.makedirs(UPLOAD_FOLDER_UPLOADED, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_CREATED, exist_ok=True)
os.makedirs(UPLOAD_FOLDER_FILLED, exist_ok=True)

# Test user credentials
TEST_USER = {
    'email': 'test@shl.com',
    'password': 'password123'
}

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# Make the root URL redirect to login if not authenticated
@app.route('/')
def index():
    if not session.get('logged_in'):
        return redirect(url_for('login'))
    return redirect(url_for('home'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Clear any existing session
    if 'logged_in' in session and not session['logged_in']:
        session.clear()
    
    # Redirect to home if already logged in
    if session.get('logged_in'):
        return redirect(url_for('home'))
        
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        if email == TEST_USER['email'] and password == TEST_USER['password']:
            session['logged_in'] = True
            session['user_email'] = email
            flash('Login successful!', 'success')
            return redirect(url_for('home'))
        else:
            flash('Invalid credentials. Please try again.', 'error')
    
    # Show login page for GET requests or failed logins
    return render_template('pages/login/login.html')

@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    # Redirect to home if already logged in
    if session.get('logged_in'):
        return redirect(url_for('home'))
        
    if request.method == 'POST':
        email = request.form.get('email')
        if email == TEST_USER['email']:
            # In a real application, send password reset email
            flash('Password reset instructions have been sent to your email.', 'success')
            return redirect(url_for('login'))
        flash('Email not found.', 'error')
    
    return render_template('pages/login/forgotpass.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out successfully.', 'info')
    return redirect(url_for('login'))

# Protected home route
@app.route('/home')
@login_required
def home():
    user_files = File.query.filter_by(user_email=session['user_email']).order_by(File.upload_date.desc()).all()
    files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type
    } for file in user_files]
    
    return render_template('index.html', files=files_data)

@app.route("/start-editing")
@login_required
def start_editing():
    user_files = File.query.filter_by(user_email=session['user_email']).order_by(File.upload_date.desc()).all()
    files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type
    } for file in user_files]
    return render_template("pages/start_editing.html", files=files_data)

@app.route("/analytics")
@login_required
def analytics():
    user_files = File.query.filter_by(user_email=session['user_email']).order_by(File.upload_date.desc()).all()
    files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type
    } for file in user_files]
    
    return render_template('Pages/analytics.html', files=files_data)

@app.route("/submissions")
@login_required
def submissions():
    # Get files for submissions data
    user_files = File.query.filter_by(user_email=session['user_email']).order_by(File.upload_date.desc()).all()
    files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type
    } for file in user_files]
    return render_template("pages/submissions.html", files=files_data)

@app.route("/settings")
@login_required
def settings():
    # Basic settings page
    return render_template("pages/settings.html")

@app.route("/designer")
@login_required
def designer_page():
    file_id = request.args.get('file_id')
    if not file_id:
        flash('No file ID provided', 'error')
        return redirect(url_for('home'))
    
    try:
        # Get file info with error handling
        file, error = get_file_info(file_id)
        if error:
            error_response, status_code = error
            flash(f'Error: {error_response.json["error"]}', 'error')
            return redirect(url_for('home'))
        
        # Generate a URL for the PDF file
        file_url = url_for('serve_pdf', file_id=file.id)
        
        # Check if the file is valid before rendering the page
        if not os.path.exists(file.file_path):
            flash('The file could not be found on disk. Please upload it again.', 'error')
            return redirect(url_for('home'))
            
        # Check if we already have a form definition for this file
        form_def = FormDefinition.query.filter_by(file_id=file.id).first()
        
        # If no form definition exists, create an empty schema
        schema = {"fields": []} 
        if form_def:
            schema = form_def.get_schema()
        
        # Log for debugging
        logging.debug(f"[DESIGNER] Rendering designer page for file ID: {file_id}, URL: {file_url}")
        
        return render_template(
            'Pages/f_designer/designpage.html', 
            file=file,
            file_url=file_url,
            schema=schema,
            form_def=form_def
        )
    except Exception as e:
        logging.error(f"[DESIGNER] Error loading file {file_id}: {str(e)}")
        logging.error(traceback.format_exc())
        flash('Error loading file for editing', 'error')
        return redirect(url_for('home'))

@app.route('/api/save-form-schema', methods=['POST'])
@login_required
def save_form_schema():
    """Save form schema definition and fields from designer page"""
    try:
        # Import the PDF portfolio utilities
        from pdf_portfolio_utils import surface_pdf_generator
        
        data = request.json
        if not data or 'file_id' not in data or 'schema' not in data:
            return jsonify({'success': False, 'error': 'Missing required data'}), 400
        
        file_id = data['file_id']
        schema = data['schema']
        fields = schema.get('fields', [])
        
        # Get the file to work with - this should be the base file
        base_file = File.query.get(file_id)
        if not base_file:
            return jsonify({'success': False, 'error': 'Base file not found'}), 404
        
        # Check if file exists on disk
        if not os.path.exists(base_file.file_path):
            return jsonify({'success': False, 'error': 'Base file not found on disk'}), 404
        
        # Check if we already have a form definition for this file
        form_def = FormDefinition.query.filter_by(file_id=file_id).first()
        
        if form_def:
            # Update existing schema
            form_def.schema = json.dumps(schema)
            form_def.updated_at = datetime.utcnow()
        else:
            # Create new form definition
            form_def = FormDefinition(
                file_id=file_id, 
                schema=schema,
                user_email=session.get('user_email', '')
            )
            db.session.add(form_def)
            db.session.commit()  # Commit to get form_def.id
        
        # Clear existing PDF form fields
        PDFFormField.query.filter_by(form_id=form_def.id).delete()
        
        # Create PDF form fields from schema
        for field in fields:
            pdf_field = PDFFormField(
                form_id=form_def.id,
                name=field.get('name', f"field_{uuid.uuid4().hex[:8]}"),
                field_type=field.get('type', 'text'),
                x=field.get('x', 0),
                y=field.get('y', 0),
                width=field.get('width', 100),
                height=field.get('height', 20),
                page=field.get('page', 0),
                default_value=field.get('default_value', ''),
                font_size=field.get('font_size'),
                font_name=field.get('font_name'),
                text_color=field.get('text_color'),
                format=field.get('format'),
                read_only=field.get('read_only', False),
                required=field.get('required', False)
            )
            db.session.add(pdf_field)
        
        # Save changes to the database
        db.session.commit()
        
        # Get output directory and create if necessary
        output_dir = os.path.join(app.root_path, 'uploads', 'created')
        os.makedirs(output_dir, exist_ok=True)
        output_filename = f"{uuid.uuid4()}.pdf"
        output_path = os.path.join(output_dir, output_filename)
        
        # Use surface PDF generator to create a new surface PDF with AcroForm fields
        try:
            # Generate the surface PDF
            surface_path = surface_pdf_generator.create_surface_pdf(base_file.file_path, fields, output_path)
            logging.info(f"Surface PDF generated at {surface_path}")
            
            # Create or update the surface file record
            surface_file = CreatedFile.query.filter_by(original_file_id=file_id).first()
            if not surface_file:
                surface_file = CreatedFile(
                    filename=output_filename,
                    original_filename=f"Form_{base_file.original_filename}",
                    file_type='pdf',
                    file_path=surface_path,
                    user_email=session.get('user_email', ''),
                    original_file_id=file_id
                )
                db.session.add(surface_file)
            else:
                # Update existing surface file
                surface_file.filename = output_filename
                surface_file.file_path = surface_path
                surface_file.modified_date = datetime.utcnow()
            
            db.session.commit()
            
            # Get or create a PDF Portfolio entry
            portfolio = PDFPortfolio.query.filter_by(base_file_id=file_id).first()
            if not portfolio:
                portfolio = PDFPortfolio(
                    base_file_id=file_id,
                    user_email=session.get('user_email', ''),
                    surface_file_id=surface_file.id
                )
                db.session.add(portfolio)
            else:
                # Update existing portfolio
                portfolio.surface_file_id = surface_file.id
                portfolio.updated_at = datetime.utcnow()
                
            db.session.commit()
            logging.debug(f"Portfolio updated with surface file ID: {surface_file.id}")
            
        except Exception as e:
            logging.error(f"Error generating surface PDF: {str(e)}")
            return jsonify({'success': False, 'error': f'Error generating surface PDF: {str(e)}'}), 500
        
        return jsonify({
            'success': True, 
            'id': form_def.id,
            'created_file_id': surface_file.id,
            'portfolio_id': portfolio.id,
            'message': 'Form schema and fields saved successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error saving form schema: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500
@app.route("/get-file/<file_id>", endpoint='get_file')
def get_file(file_id):
    file = File.query.get_or_404(file_id)
    try:
        return send_file(
            os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename),
            mimetype='application/pdf'
        )
    except Exception as e:
        print(f"Error serving file: {str(e)}")
        return jsonify({'error': str(e)}), 404

@app.route('/upload', methods=['POST'])
@login_required
def upload_document():
    """Handle PDF / DOCX upload. Returns new file metadata."""
    try:
        # Import the PDF portfolio utilities
        from pdf_portfolio_utils import surface_pdf_generator
        
        # Check if file exists in request
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file part'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No selected file'}), 400

        filename = secure_filename(file.filename)
        file_ext = filename.rsplit('.', 1)[-1].lower()
        uid = uuid.uuid4().hex
        stored_pdf_path = os.path.join(UPLOAD_FOLDER_UPLOADED, f"{uid}.pdf")
        
        if file_ext == 'pdf':
            try:
                file.save(stored_pdf_path)
                logging.debug(f"PDF saved to {stored_pdf_path}")
            except Exception as e:
                logging.error(f"Error saving PDF file: {str(e)}")
                return jsonify({'success': False, 'error': f'Error saving PDF file: {str(e)}'}), 500
        elif file_ext == 'docx':
            temp_docx = os.path.join(UPLOAD_FOLDER_UPLOADED, f"{uid}.docx")
            try:
                file.save(temp_docx)
                logging.debug(f"DOCX saved to {temp_docx}")
                
                # Initialize COM for docx2pdf
                try:
                    logging.debug("Initializing COM for DOCX conversion")
                    pythoncom.CoInitialize()
                    convert(temp_docx, stored_pdf_path)
                    logging.debug(f"DOCX converted to PDF: {stored_pdf_path}")
                except Exception as conv_err:
                    logging.error(f"DOCX conversion error: {str(conv_err)}")
                    return jsonify({'success': False, 'error': f'DOCX to PDF conversion failed: {str(conv_err)}'}), 500
                finally:
                    # Always uninitialize COM
                    pythoncom.CoUninitialize()
                    logging.debug("COM uninitialized")
            except Exception as e:
                logging.error(f"Error processing DOCX: {str(e)}")
                return jsonify({'success': False, 'error': f'Error processing DOCX: {str(e)}'}), 500
            finally:
                # Clean up temp DOCX file
                if os.path.exists(temp_docx):
                    try:
                        os.remove(temp_docx)
                        logging.debug(f"Temporary DOCX file removed: {temp_docx}")
                    except Exception as del_err:
                        logging.error(f"Error deleting temporary file: {str(del_err)}")
        else:
            return jsonify({'success': False, 'error': 'Only PDF and DOCX allowed'}), 400

        # Verify the PDF is readable
        try:
            reader = PdfReader(stored_pdf_path)
            pages = len(reader.pages)
            logging.debug(f"PDF verified with {pages} pages")
            
            # Extract PDF metadata
            pdf_metadata = surface_pdf_generator.extract_pdf_metadata(stored_pdf_path)
            logging.debug(f"Extracted metadata: {pdf_metadata}")
        except Exception as e:
            logging.error(f"Error reading PDF: {str(e)}")
            return jsonify({'success': False, 'error': f'Error reading PDF: {str(e)}'}), 500

        # Create base file database record
        try:
            new_file = File(
                filename=f"{uid}.pdf",
                original_filename=filename,
                file_type='pdf',
                file_path=stored_pdf_path,
                user_email=session.get('user_email', '')
            )
            db.session.add(new_file)
            db.session.commit()
            logging.debug(f"Base file database record created with ID {new_file.id}")
            
            # Create PDF Portfolio entry linking base PDF (no surface PDF yet)
            portfolio = PDFPortfolio(
                base_file_id=new_file.id,
                user_email=session.get('user_email', ''),
                surface_file_id=None  # Will be set when surface PDF is generated in design page
            )
            db.session.add(portfolio)
            db.session.commit()
            logging.debug(f"PDF Portfolio created with ID {portfolio.id}")
        except Exception as db_err:
            logging.error(f"Database error: {str(db_err)}")
            return jsonify({'success': False, 'error': f'Database error: {str(db_err)}'}), 500            
    except Exception as e:
        logging.error(f"Unexpected error during upload: {str(e)}")
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500
        
    # Return success response with file metadata formatted for frontend compatibility
    return jsonify({
        'success': True,
        'file_id': new_file.id,  # Use 'file_id' as the key since that's what start_editing.js expects
        'id': new_file.id,       # Also include 'id' for backward compatibility 
        'original_filename': new_file.original_filename,
        'pages': pages,
        'redirect_url': url_for('design_page', file_id=new_file.id)
    }), 201

@app.route("/files")
@login_required
def get_files():
    user_files = File.query.filter_by(user_email=session['user_email']).order_by(File.upload_date.desc()).all()
    files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type
    } for file in user_files]
    return jsonify(files_data)

@app.route("/download/<int:file_id>")
@login_required
def download_file_route(file_id):
    file = File.query.get_or_404(file_id)
    if file.user_email != session['user_email']:
        return jsonify({"error": "Unauthorized"}), 403
    return send_file(file.file_path, 
                    download_name=file.original_filename,
                    as_attachment=True)

@app.route("/edit/<int:file_id>")
@login_required
def edit_file(file_id):
    file = File.query.get_or_404(file_id)
    if file.user_email != session['user_email']:
        return jsonify({"error": "Unauthorized"}), 403
    
    # Check if we're using the portfolio approach (look for portfolio ID in query params or localStorage)
    portfolio_id = request.args.get('portfolio_id')
    use_portfolio_approach = portfolio_id is not None
    
    # If file is a surface file from a portfolio, use portfolio approach
    portfolio = PDFPortfolio.query.filter_by(surface_file_id=file_id).first()
    if portfolio:
        use_portfolio_approach = True
        app.logger.debug(f"Found portfolio for surface file: {portfolio.id}")
    elif portfolio_id:
        # Try to find portfolio by ID from query params
        portfolio = PDFPortfolio.query.get(portfolio_id)
        app.logger.debug(f"Looking up portfolio by ID from query: {portfolio_id}")
    
    # Get form schema if available
    schema = None
    form_def = FormDefinition.query.filter_by(file_id=file_id).first()
    if form_def:
        try:
            if isinstance(form_def.schema, str):
                schema = json.loads(form_def.schema)
            else:
                schema = form_def.schema
        except Exception as e:
            app.logger.error(f"Error parsing form schema: {str(e)}")
    
    app.logger.debug(f"Edit file: {file_id}, portfolio: {portfolio.id if portfolio else 'None'}, use_portfolio_approach: {use_portfolio_approach}")
    
    return render_template(
        "Pages/f_builder/editPage.html", 
        file=file,
        portfolio=portfolio,
        schema=schema,
        use_portfolio_approach=use_portfolio_approach
    )

@app.route("/delete/<int:file_id>", methods=["DELETE"])
@login_required
def delete_file_route(file_id):
    file = File.query.get_or_404(file_id)
    if file.user_email != session['user_email']:
        return jsonify({"error": "Unauthorized"}), 403
    
    try:
        # Delete physical file
        os.remove(file.file_path)
        # Delete database record
        db.session.delete(file)
        db.session.commit()
        return jsonify({"message": "File deleted successfully"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/preview/<file_id>')
@login_required
def preview_file_route(file_id):
    file = File.query.get_or_404(file_id)
    try:
        return send_from_directory(UPLOAD_FOLDER_UPLOADED, file.filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/preview/<file_id>', methods=['GET'], endpoint='api_preview_file')
def preview_file(file_id):
    file = File.query.get_or_404(file_id)
    try:
        return send_from_directory(UPLOAD_FOLDER_UPLOADED, file.filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/delete/<file_id>', methods=['DELETE'], endpoint='api_delete_file')
def delete_file(file_id):
    file = File.query.get_or_404(file_id)
    try:
        os.remove(os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename))
        db.session.delete(file)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/download/<file_id>', methods=['GET'], endpoint='api_download_file')
def download_file(file_id):
    file = File.query.get_or_404(file_id)
    try:
        return send_file(
            os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename),
            as_attachment=True,
            download_name=file.name
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/upload', methods=['POST'], endpoint='api_upload_file')
def api_upload_file():
    if 'files[]' not in request.files:
        return jsonify({'success': False, 'error': 'No file part'})
    
    files = request.files.getlist('files[]')
    uploaded_files = []
    
    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename or '')
            unique_filename = str(uuid.uuid4()) + os.path.splitext(filename)[1]
            file.save(os.path.join(UPLOAD_FOLDER_UPLOADED, unique_filename))
            
            new_file = File(
                filename=unique_filename,
                original_filename=filename,
                file_type=os.path.splitext(filename)[1].lower()[1:],
                file_path=os.path.join(UPLOAD_FOLDER_UPLOADED, unique_filename),
                user_email=session.get('user_email', '')
            )
            db.session.add(new_file)
            uploaded_files.append(filename)
    
    if uploaded_files:
        db.session.commit()
        return jsonify({'success': True, 'files': uploaded_files})
    
    return jsonify({'success': False, 'error': 'No valid files uploaded'})

@app.route("/saved-files")
@login_required
def saved_files():
    """
    Show saved files using the PDF Portfolio approach
    - Base PDFs are hidden in the display
    - Surface PDFs are shown for form templates
    - Filled PDFs are grouped by portfolio
    """
    # Get all PDF portfolios for the user with their associated files
    portfolios = PDFPortfolio.query.filter_by(user_email=session['user_email']).all()
    
    # Create portfolio data structure
    portfolio_data = []
    
    for portfolio in portfolios:
        # Get base file (original upload - not shown to users directly)
        base_file = File.query.get(portfolio.base_file_id)
        if not base_file:
            continue
            
        # Get surface file (with AcroForm fields)
        surface_file = None
        if portfolio.surface_file_id:
            surface_file = CreatedFile.query.get(portfolio.surface_file_id)
        
        # Get submissions for this portfolio - with error handling for schema migration
        try:
            submissions = Submission.query.filter_by(portfolio_id=portfolio.id).all()
        except Exception as e:
            logging.error(f"Error querying submissions by portfolio_id: {str(e)}")
            submissions = []  # Default to empty list if query fails
        
        # Get filled forms from submissions
        filled_forms = []
        for submission in submissions:
            if hasattr(submission, 'filled_file_id') and submission.filled_file_id:
                filled_form = FilledForm.query.get(submission.filled_file_id)
                if filled_form:
                    submission_metadata = {}
                    if hasattr(submission, 'form_metadata') and submission.form_metadata:
                        try:
                            submission_metadata = json.loads(submission.form_metadata)
                        except Exception as e:
                            logging.error(f"Error parsing submission metadata: {str(e)}")
                    
                    filled_forms.append({
                        'id': filled_form.id,
                        'name': filled_form.original_filename,
                        'filled_date': filled_form.filled_date.strftime('%Y-%m-%d %H:%M:%S'),
                        'submission_id': submission.id,
                        'metadata': submission_metadata
                    })
        
        # Add portfolio to result
        portfolio_data.append({
            'id': portfolio.id,
            'base_file': {
                'id': base_file.id,
                'name': base_file.original_filename,
                'upload_date': base_file.upload_date.strftime('%Y-%m-%d %H:%M:%S')
            },
            'surface_file': {
                'id': surface_file.id if surface_file else None,
                'name': surface_file.original_filename if surface_file else None,
                'upload_date': surface_file.upload_date.strftime('%Y-%m-%d %H:%M:%S') if surface_file else None
            } if surface_file else None,
            'filled_forms': filled_forms,
            'status': portfolio.status,
            'created_at': portfolio.created_at.strftime('%Y-%m-%d %H:%M:%S')
        })
    
    # Get any legacy uploaded files not in portfolios
    all_portfolio_base_file_ids = [p.base_file_id for p in portfolios]
    legacy_files = File.query.filter(
        File.user_email == session['user_email'],
        ~File.id.in_(all_portfolio_base_file_ids) if all_portfolio_base_file_ids else True
    ).order_by(File.upload_date.desc()).all()
    
    legacy_files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type,
        'source': 'legacy_uploaded'
    } for file in legacy_files]
    
    # Get any legacy created files not linked to portfolios
    legacy_created_files = CreatedFile.query.filter_by(user_email=session['user_email']).all()
    
    legacy_created_files_data = [{
        'id': file.id,
        'name': file.original_filename,
        'upload_date': file.upload_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': file.file_type,
        'source': 'legacy_created'
    } for file in legacy_created_files]
    
    # Get any legacy filled forms
    legacy_filled_forms = FilledForm.query.filter_by(user_email=session['user_email']).all()
    
    legacy_filled_forms_data = [{
        'id': form.id,
        'name': form.original_filename,
        'filled_date': form.filled_date.strftime('%Y-%m-%d %H:%M:%S'),
        'file_type': form.file_type,
        'source': 'legacy_filled',
        'source_file_id': form.source_file_id
    } for form in legacy_filled_forms]
    
    return render_template(
        "pages/saved_files/saved_files.html", 
        portfolios=portfolio_data,
        legacy_files=legacy_files_data,
        legacy_created_files=legacy_created_files_data,
        legacy_filled_forms=legacy_filled_forms_data
    )

@app.route("/save-form", methods=["POST"])
@login_required
def save_form():
    try:
        if 'file' not in request.files:
            logging.error("[SAVE_FORM] No file found in request")
            return jsonify({"error": "No file uploaded"}), 400
        
        file = request.files['file']
        
        if not file or not file.filename:
            logging.error("[SAVE_FORM] Empty file or no filename provided")
            return jsonify({"error": "Invalid file"}), 400
        
        # Generate secure filename from original
        filename = secure_filename(file.filename)
        
        # Create unique filename for storage
        unique_filename = f"{uuid.uuid4()}.pdf"
        
        # Ensure the created folder exists
        os.makedirs(UPLOAD_FOLDER_CREATED, exist_ok=True)
        
        # Save to filesystem
        file_path = os.path.join(UPLOAD_FOLDER_CREATED, unique_filename)
        file.save(file_path)
        
        logging.debug(f"[SAVE_FORM] File saved to {file_path}")
        
        # Create a new database record
        new_file = CreatedFile(
            filename=unique_filename,
            original_filename=filename,
            file_type='pdf',
            file_path=file_path,
            user_email=session['user_email']
        )
        
        # Add and commit to database
        db.session.add(new_file)
        db.session.commit()
        
        logging.info(f"[SAVE_FORM] New file created with ID: {new_file.id}, Filename: {new_file.original_filename}")
        
        return jsonify({
            "success": True, 
            "id": new_file.id, 
            "name": new_file.original_filename,
            "path": file_path
        })
    except Exception as e:
        db.session.rollback()
        logging.error(f"[SAVE_FORM] Error: {str(e)}")
        logging.error(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/cleanup', methods=['POST'])
def cleanup_files():
    try:
        # Delete all records from the database
        File.query.delete()
        db.session.commit()
        
        # Delete all files from the uploads directory
        upload_dir = UPLOAD_FOLDER_UPLOADED
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
        
        return jsonify({'success': True, 'message': 'All files cleaned up successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/sync-files', methods=['POST'])
def sync_files():
    try:
        # Get all files from database
        db_files = File.query.all()
        db_files_dict = {file.filename: file for file in db_files}
        
        # Get all files from upload directory
        upload_dir = UPLOAD_FOLDER_UPLOADED
        actual_files = set(os.listdir(upload_dir))
        
        # Remove database records where physical file is missing
        for db_file in db_files:
            if db_file.filename not in actual_files:
                print(f"Removing DB record for missing file: {db_file.filename}")
                db.session.delete(db_file)
        
        # Remove physical files that aren't in database
        for filename in actual_files:
            if filename not in db_files_dict and filename != 'placeholder.doc':
                file_path = os.path.join(upload_dir, filename)
                if os.path.isfile(file_path):
                    print(f"Removing orphaned file: {filename}")
                    os.remove(file_path)
        
        db.session.commit()
        return jsonify({
            'success': True,
            'message': 'Files synchronized successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        })

@app.route('/api/list-files', methods=['GET'])
def list_files():
    try:
        # Get all files from database
        db_files = File.query.all()
        db_files_info = [{'id': f.id, 'name': f.name, 'filename': f.filename} for f in db_files]
        
        # Get all files from upload directory
        upload_dir = UPLOAD_FOLDER_UPLOADED
        actual_files = os.listdir(upload_dir)
        
        return jsonify({
            'success': True,
            'database_files': db_files_info,
            'actual_files': actual_files
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })
#Ran into an issue with docx2pdf on Windows requiring COM initialization and file conversion
def convert_to_pdf(file_path):
    try:
        pythoncom.CoInitialize()  # Initialize COM
        convert(file_path)  # docx2pdf conversion
    finally:
        pythoncom.CoUninitialize()  # Cleanup

# Example usage in a route:
@app.route('/convert/<file_id>', methods=['POST'])
def convert_document(file_id):
    try:
        file = File.query.get_or_404(file_id)
        file_path = os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename)
        convert_to_pdf(file_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/editor/<file_id>')
def editor(file_id):
    file = File.query.get_or_404(file_id)
    file_path = os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename)
    if not os.path.exists(file_path):
        flash('File not found', 'error')
        return redirect(url_for('saved_files'))
    return render_template('editor.html', file=file)

@app.route('/design/<file_id>', endpoint='design_page')
@login_required
def design(file_id):
    # Try to find the file in regular files table first
    file = File.query.get(file_id)
    
    # If not found, try created files
    if not file:
        file = CreatedFile.query.get_or_404(file_id)
    
    # Generate URL for serving the PDF
    file_url = url_for('serve_pdf', file_id=file.id)
    
    # Log for debugging
    app.logger.debug(f"Opening design page for file: {file.id}, {file.original_filename}, URL: {file_url}")
    
    return render_template('Pages/f_designer/designpage.html', file=file, file_url=file_url)

@app.route('/api/design/file/<file_id>', endpoint='get_design_file')
@login_required
def get_design_file(file_id):
    # Try to fetch file from regular files database first
    file = File.query.get(file_id)
    
    # If not found in regular files, try created files
    if not file:
        file = CreatedFile.query.get(file_id)
        print(f'[SERVE] File found in CreatedFile table: {file_id}')
    
    # If still not found, return 404
    if not file:
        print(f'[SERVE] File not found in any table: {file_id}')
        return jsonify({'error': 'File not found'}), 404
    
    # Security check
    if file.user_email != session['user_email']:
        print(f'[SERVE] Unauthorized access for file {file_id} by user {session.get("user_email")}')
        return jsonify({'error': 'Unauthorized'}), 403
    try:
        print(f'[SERVE] Attempting to serve file: {file.file_path}')
        if not os.path.exists(file.file_path):
            print(f'[SERVE] File not found on disk: {file.file_path}')
            return jsonify({'error': 'File not found'}), 404
        return send_file(
            file.file_path,
            mimetype='application/pdf'
        )
    except Exception as e:
        print(f"[SERVE ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 404

@app.route('/view/file/<file_id>', endpoint='view_file')
def view_file(file_id):
    file = File.query.get_or_404(file_id)
    try:
        return send_file(
            os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename),
            mimetype='application/pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/pdf-editor')
@login_required
def pdf_editor():
    file_id = request.args.get('file_id')
    if not file_id:
        return redirect(url_for('start_editing'))
    file = File.query.get_or_404(file_id)
    # Generate a local URL for the PDF file (served by another Flask route)
    file_url = url_for('serve_pdf', file_id=file.id)
    return render_template('Pages/f_designer/designpage.html', file=file, file_url=file_url)

@app.route("/serve-pdf/<file_id>", endpoint="serve_pdf")
@login_required
def serve_pdf(file_id):
    try:
        # Log the request for troubleshooting
        logging.debug(f"[SERVE_PDF] Request to serve file ID: {file_id}")
        
        # Try to fetch file from regular files database first
        file = File.query.get(file_id)
        file_type = "File"
        
        # If not found in regular files, try created files
        if not file:
            file = CreatedFile.query.get(file_id)
            file_type = "CreatedFile"
            logging.debug(f"[SERVE_PDF] File found in CreatedFile table: {file_id}")
        
        # If still not found, return 404
        if not file:
            logging.error(f"[SERVE_PDF] File not found in any table: {file_id}")
            return jsonify({'error': 'File not found in database'}), 404
        
        # Security check - ensure user can only access their own files
        if file.user_email != session.get('user_email'):
            logging.warning(f"[SERVE_PDF] Unauthorized access attempt: {file_id} by {session.get('user_email')}")
            return jsonify({'error': 'Unauthorized access'}), 403
        
        # Get the absolute file path
        file_path = file.file_path
        
        # Debug logging
        logging.debug(f"[SERVE_PDF] Attempting to serve {file_type} file: {file_path}")
        
        # Define possible locations to search for the file
        potential_paths = [
            file_path,  # Original path from database
            os.path.join(UPLOAD_FOLDER_UPLOADED, file.filename),  # Uploaded folder
            os.path.join(UPLOAD_FOLDER_CREATED, file.filename),   # Created folder
            os.path.join(UPLOAD_FOLDER, file.filename),           # General uploads folder
        ]
        
        # For CreatedFiles, also check the original PDF location
        if file_type == "CreatedFile":
            # Try to find the most recent version in the created folder
            created_folder = os.path.join(UPLOAD_FOLDER_CREATED)
            if os.path.exists(created_folder):
                potential_paths.append(os.path.join(created_folder, file.filename))
        
        # Try each potential path
        valid_path = None
        for path in potential_paths:
            logging.debug(f"[SERVE_PDF] Checking potential file path: {path}")
            if os.path.exists(path) and os.path.isfile(path):
                logging.info(f"[SERVE_PDF] Found file at: {path}")
                valid_path = path
                
                # Update database with correct path if it's different from what's stored
                if valid_path != file_path:
                    file.file_path = valid_path
                    db.session.commit()
                    logging.info(f"[SERVE_PDF] Updated file path in database to: {valid_path}")
                
                break
        
        if not valid_path:
            # Advanced debugging info
            logging.error(f"[SERVE_PDF] File not found in any potential location. Details: ID={file_id}, Type={file_type}, Filename={file.filename}")
            
            # List contents of upload folders to help debugging
            for folder in [UPLOAD_FOLDER, UPLOAD_FOLDER_UPLOADED, UPLOAD_FOLDER_CREATED]:
                if os.path.exists(folder):
                    contents = os.listdir(folder)
                    logging.debug(f"[SERVE_PDF] Contents of {folder}: {contents}")
            
            return jsonify({'error': 'File not found on disk'}), 404
        
        # Ensure the file is actually readable
        try:
            with open(valid_path, 'rb') as f:
                # Just read a few bytes to check if file is readable
                f.read(10)
        except Exception as read_error:
            logging.error(f"[SERVE_PDF] File exists but is not readable: {str(read_error)}")
            return jsonify({'error': 'File exists but is not readable'}), 500
        
        # Serve the file with the correct MIME type and cache control headers
        response = send_file(
            valid_path,
            mimetype="application/pdf",
            as_attachment=False,
            download_name=file.original_filename if file.original_filename else None
        )
        
        # Add very strong cache control headers to prevent caching issues with PDF.js
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        
        # Add a unique ETag to force revalidation (includes file timestamp)
        try:
            file_timestamp = str(int(os.path.getmtime(valid_path)))
            response.headers['ETag'] = f'"{file_timestamp}-{file_id}"'
        except:
            # Fallback to a random ETag if we can't get the file timestamp
            response.headers['ETag'] = f'"{uuid.uuid4()}"'
        
        logging.debug(f"[SERVE_PDF] Successfully serving file: {valid_path}")
        return response
        
    except Exception as e:
        logging.error(f"[SERVE_PDF] Error: {str(e)}")
        logging.error(traceback.format_exc())
        logging.error(traceback.format_exc())
        return jsonify({'error': f'Error serving PDF: {str(e)}'}), 500

@app.route('/api/fill-and-embed', methods=['POST'])
@login_required
def fill_and_embed():
    try:
        file_id = request.form.get('file_id')
        field_values = request.form.get('field_values')
        payload = request.form.get('payload')
        if not file_id or not field_values or not payload:
            return jsonify({'success': False, 'error': 'Missing required data'}), 400
        field_values = json.loads(field_values)
        payload = json.loads(payload)
        # Get the original PDF path
        file = File.query.get_or_404(file_id)
        input_pdf_path = file.file_path
        # Prepare output path
        unique_filename = f"{uuid.uuid4()}.pdf"
        output_pdf_path = os.path.join(UPLOAD_FOLDER_CREATED, unique_filename)
        # Open and fill PDF
        reader = PdfReader(input_pdf_path)
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        writer.update_page_form_field_values(writer.pages[0], field_values)
        # Embed JSON payload
        payload_json = json.dumps(payload, indent=2).encode("utf-8")
        file_entry = DecodedStreamObject()
        file_entry.set_data(payload_json)
        file_entry.update({
            NameObject("/Type"): NameObject("/EmbeddedFile"),
            NameObject("/Subtype"): NameObject("/application/json"),
        })
        file_entry_obj = writer._add_object(file_entry)
        ef_dict = DictionaryObject({
            NameObject("/F"): file_entry_obj,
            NameObject("/UF"): file_entry_obj,
        })
        filespec = DictionaryObject({
            NameObject("/Type"): NameObject("/Filespec"),
            NameObject("/F"): create_string_object("payload.json"),
            NameObject("/EF"): ef_dict,
        })
        filespec_obj = writer._add_object(filespec)
        embedded_files_names = [create_string_object("payload.json"), filespec_obj]
        embedded_files_dict = DictionaryObject({
            NameObject("/Names"): embedded_files_names
        })
        embedded_files_obj = writer._add_object(embedded_files_dict)
        writer._root_object.update({
            NameObject("/Names"): DictionaryObject({
                NameObject("/EmbeddedFiles"): embedded_files_obj
            })
        })
        # Save the new PDF
        with open(output_pdf_path, "wb") as f_out:
            writer.write(f_out)
        # Save to CreatedFile table
        new_file = CreatedFile(
            filename=unique_filename,
            original_filename=file.original_filename,
            file_type='pdf',
            file_path=output_pdf_path,
            user_email=session['user_email']
        )
        db.session.add(new_file)
        db.session.commit()
        return jsonify({'success': True, 'id': new_file.id, 'name': new_file.original_filename})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/debug-pdf/<file_id>")
@login_required
def debug_pdf(file_id):
    file = File.query.get_or_404(file_id)
    return jsonify({
        "file_id": file.id,
        "filename": file.filename,
        "file_path": file.file_path,
        "exists": os.path.exists(file.file_path),
        "size": os.path.getsize(file.file_path) if os.path.exists(file.file_path) else 0,
        "serve_url": url_for('serve_pdf', file_id=file.id)
    })

# Add this at an appropriate place in the file, near other API routes

@app.route('/api/add-form-fields', methods=['POST'])
@login_required
def add_form_fields():
    """
    Endpoint to add fields to a PDF form using PyPDFForm.
    Expects JSON with:
    - pdf_filename: The name of the uploaded/created PDF file
    - fields: List of field definitions with coordinates, types, etc.
    """
    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400
        
    # Get the file ID
    file_id = data.get('file_id')
    if not file_id:
        return jsonify({'success': False, 'error': 'File ID is required'}), 400
    
    # Get the fields data
    fields = data.get('fields', [])
    if not fields:
        return jsonify({'success': False, 'error': 'No fields provided'}), 400
    
    # Get the file from database
    source_file = File.query.get(file_id) or CreatedFile.query.get(file_id)
    if not source_file:
        return jsonify({'success': False, 'error': 'File not found'}), 404
    
    if not os.path.exists(source_file.file_path):
        return jsonify({'success': False, 'error': 'PDF file not found on server'}), 404
    
    try:
        # Create or update form definition
        form_def = FormDefinition.query.filter_by(file_id=file_id).first()
        if not form_def:
            form_def = FormDefinition(
                file_id=file_id,
                schema=json.dumps({"fields": []}),
                user_email=session['user_email']
            )
            db.session.add(form_def)
            db.session.commit()
        
        # Clear existing fields for this form
        PDFFormField.query.filter_by(form_id=form_def.id).delete()
        
        # Add new fields
        for field in fields:
            pdf_field = PDFFormField(
                form_id=form_def.id,
                name=field.get('name', f"field_{uuid.uuid4().hex[:8]}"),
                field_type=field.get('type', 'text'),
                x=field.get('x', 0),
                y=field.get('y', 0),
                width=field.get('width', 100),
                height=field.get('height', 20),
                page=field.get('page', 0),
                default_value=field.get('default_value', ''),
                font_size=field.get('font_size'),
                font_name=field.get('font_name'),
                text_color=field.get('text_color'),
                format=field.get('format'),
                read_only=field.get('read_only', False),
                required=field.get('required', False)
            )
            db.session.add(pdf_field)
        
        # Create the actual PDF with fields
        output_dir = os.path.join(app.root_path, 'uploads', 'created')
        os.makedirs(output_dir, exist_ok=True)
        output_filename = f"{uuid.uuid4()}.pdf"
        output_path = os.path.join(output_dir, output_filename)
        
        # Import the PDF portfolio utilities
        from pdf_portfolio_utils import surface_pdf_generator
        
        # Create the surface PDF with fields using the utility
        try:
            # Create the surface PDF with fields
            output_path = surface_pdf_generator.create_surface_pdf(
                base_pdf_path=source_file.file_path,
                form_fields=fields,
                output_path=output_path
            )
                
        except Exception as e:
            logging.error(f"Error creating PDF with fields: {str(e)}")
            return jsonify({'error': f'Failed to create PDF: {str(e)}'}), 500
        
        # Create or update the created file record
        created_file = CreatedFile.query.filter_by(original_file_id=file_id).first()
        if not created_file:
            created_file = CreatedFile(
                filename=output_filename,
                original_filename=f"Form_{source_file.original_filename}",
                file_type='pdf',
                file_path=output_path,
                user_email=session['user_email'],
                original_file_id=file_id
            )
            db.session.add(created_file)
        else:
            # Update existing file
            created_file.filename = output_filename
            created_file.file_path = output_path
            created_file.modified_date = datetime.utcnow()
        
        db.session.commit();
        
        # Return success with created file ID
        return jsonify({
            'success': True,
            'message': f"Added {len(fields)} fields to the PDF form",
            'created_file_id': created_file.id,
            'url': url_for('serve_created_pdf', file_id=created_file.id, _external=True)
        })
        
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error adding form fields: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/fill-form', methods=['POST'])
@login_required
def fill_form():
    """Save filled form data and generate a filled PDF"""
    try:
        # Import the PDF portfolio utilities
        from pdf_portfolio_utils import surface_pdf_generator
        
        data = request.json
        if not data or 'portfolio_id' not in data or 'form_data' not in data:
            return jsonify({'success': False, 'error': 'Missing required data'}), 400
        
        portfolio_id = data['portfolio_id']
        form_data = data['form_data']
        
        # Get the PDF portfolio
        portfolio = PDFPortfolio.query.get(portfolio_id)
        if not portfolio:
            return jsonify({'success': False, 'error': 'Portfolio not found'}), 404
        
        # Security check - only the owner can fill their forms
        if portfolio.user_email != session.get('user_email', ''):
            return jsonify({'success': False, 'error': 'Unauthorized access'}), 403
            
        # Get the surface file
        surface_file = CreatedFile.query.get(portfolio.surface_file_id)
        if not surface_file:
            return jsonify({'success': False, 'error': 'Surface file not found'}), 404
            
        # Check if surface file exists on disk
        if not os.path.exists(surface_file.file_path):
            return jsonify({'success': False, 'error': 'Surface file not found on disk'}), 404
            
        # Handle existing filled form if provided
        filled_form_id = data.get('filled_form_id')
        filled_form = None
        if filled_form_id:
            filled_form = FilledForm.query.get(filled_form_id)
            if filled_form and filled_form.user_email != session.get('user_email', ''):
                return jsonify({'success': False, 'error': 'Unauthorized access to filled form'}), 403
            
        # Generate a filled PDF with the form data
        try:
            # Create output path for filled PDF
            filled_dir = os.path.join(app.root_path, 'uploads', 'filled')
            os.makedirs(filled_dir, exist_ok=True)
            filled_filename = f"filled_{uuid.uuid4()}.pdf"
            filled_path = os.path.join(filled_dir, filled_filename)
            
            # Fill the PDF with the form data using our improved utility
            filled_path = surface_pdf_generator.fill_surface_pdf(surface_file.file_path, form_data, filled_path)
            
            # Extract metadata from filled PDF
            pdf_metadata = surface_pdf_generator.extract_pdf_metadata(filled_path)
            
            # Update existing or create new filled form record
            if filled_form:
                # Update existing filled form
                filled_form.filename = filled_filename
                filled_form.file_path = filled_path
                filled_form.form_data = json.dumps(form_data)
                filled_form.modified_date = datetime.utcnow()
                filled_form.field_count = pdf_metadata.get('total_fields', 0)
                
                # Update existing submission or create new
                submission = Submission.query.filter_by(filled_file_id=filled_form.id).first()
                if submission:
                    submission.form_data = form_data
                    submission.form_metadata = pdf_metadata
                    submission.modified_date = datetime.utcnow()
                else:
                    submission = Submission(
                        portfolio_id=portfolio_id,
                        filled_file_id=filled_form.id,
                        form_data=form_data,
                        form_metadata=pdf_metadata,
                        user_email=session.get('user_email', ''),
                        status='submitted'
                    )
                    db.session.add(submission)
            else:
                # Create new filled form record
                filled_form = FilledForm(
                    filename=filled_filename,
                    original_filename=f"Filled_{surface_file.original_filename}",
                    file_type='pdf',
                    file_path=filled_path,
                    user_email=session.get('user_email', ''),
                    source_file_id=surface_file.id,
                    form_data=json.dumps(form_data),
                    field_count=pdf_metadata.get('total_fields', 0)
                )
                db.session.add(filled_form)
                db.session.flush()  # Get the ID for the new filled form
                
                # Create submission record with form data and metadata
                submission = Submission(
                    portfolio_id=portfolio_id,
                    filled_file_id=filled_form.id,
                    form_data=form_data,
                    form_metadata=pdf_metadata,
                    user_email=session.get('user_email', ''),
                    status='submitted'
                )
                db.session.add(submission)
            
            db.session.commit()
            
            logging.info(f"Form filled and saved successfully. Submission ID: {submission.id}")
            
            return jsonify({
                'success': True,
                'submission_id': submission.id,
                'filled_file_id': filled_form.id,
                'message': 'Form filled and saved successfully'
            })
            
        except Exception as e:
            logging.error(f"Error filling form: {str(e)}")
            return jsonify({'success': False, 'error': f'Error filling form: {str(e)}'}), 500
            
    except Exception as e:
        logging.error(f"Unexpected error during form filling: {str(e)}")
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/save-filled-form', methods=['POST'])
@login_required
def save_filled_form():
    """Save filled form data from the edit page"""
    try:
        # Get form data
        source_file_id = request.form.get('sourceFileId')
        form_data_str = request.form.get('formData')
        filename = request.form.get('filename')
        filled_form_id = request.form.get('filledFormId')  # If editing existing form
        
        if not source_file_id or not form_data_str:
            return jsonify({'success': False, 'error': 'Missing required data'}), 400
        
        # Parse form data JSON
        try:
            form_data = json.loads(form_data_str)
        except Exception as e:
            return jsonify({'success': False, 'error': f'Invalid form data format: {str(e)}'}), 400
        
        # Get source file
        source_file = CreatedFile.query.get(source_file_id)
        if not source_file:
            source_file = File.query.get(source_file_id)
        
        if not source_file:
            return jsonify({'success': False, 'error': 'Source file not found'}), 404
            
        # Check if source file exists on disk
        if not os.path.exists(source_file.file_path):
            return jsonify({'success': False, 'error': 'Source file not found on disk'}), 404
        
        # Generate output path for filled PDF
        filled_dir = os.path.join(app.root_path, 'uploads', 'filled')
        os.makedirs(filled_dir, exist_ok=True)
        filled_filename = secure_filename(filename) if filename else f"filled_{uuid.uuid4()}.pdf"
        filled_path = os.path.join(filled_dir, filled_filename)
        
        # Check if we're editing an existing form
        if filled_form_id:
            existing_form = FilledForm.query.get(filled_form_id)
            if existing_form:
                filled_path = existing_form.file_path
        
        # Import the needed module
        from pdf_portfolio_utils import surface_pdf_generator
        
        # Fill the PDF with form data
        filled_path = surface_pdf_generator.fill_surface_pdf(source_file.file_path, form_data, filled_path)
        
        # Get portfolio ID - check if source file is part of a portfolio
        portfolio = PDFPortfolio.query.filter_by(surface_file_id=source_file.id).first()
        portfolio_id = portfolio.id if portfolio else None
        
        # Create or update filled form record
        if filled_form_id:
            filled_form = FilledForm.query.get(filled_form_id)
            if filled_form:
                filled_form.form_data = json.dumps(form_data)
                filled_form.modified_date = datetime.utcnow()
            else:
                # Create new record if ID not found
                filled_form = FilledForm(
                    filename=filled_filename,
                    original_filename=filename or f"Filled_{source_file.original_filename}",
                    file_type='pdf',
                    file_path=filled_path,
                    user_email=session.get('user_email', ''),
                    source_file_id=source_file.id,
                    form_data=json.dumps(form_data)
                )
                db.session.add(filled_form)
        else:
            # Create new filled form
            filled_form = FilledForm(
                filename=filled_filename,
                original_filename=filename or f"Filled_{source_file.original_filename}",
                file_type='pdf',
                file_path=filled_path,
                user_email=session.get('user_email', ''),
                source_file_id=source_file.id,
                form_data=json.dumps(form_data)
            )
            db.session.add(filled_form)
        
        db.session.commit()
        
        # Create submission record if we have a portfolio
        if portfolio_id:
            # Extract metadata from filled PDF
            pdf_metadata = surface_pdf_generator.extract_pdf_metadata(filled_path)
            
            # Create or update submission
            submission = Submission(
                portfolio_id=portfolio_id,
                filled_file_id=filled_form.id,
                user_email=session.get('user_email', ''),
                form_metadata=pdf_metadata,
                status='submitted'
            )
            submission.form_data = json.dumps(form_data)
            db.session.add(submission)
            db.session.commit()
            
            return jsonify({
                'success': True,
                'submission_id': submission.id,
                'filled_file_id': filled_form.id,
                'message': 'Form filled and saved successfully'
            })
        else:
            return jsonify({
                'success': True,
                'filled_file_id': filled_form.id,
                'message': 'Form filled and saved successfully'
            })
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"Error saving filled form: {str(e)}")
        logging.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

# Helper functions for file management
def get_file_info(file_id):
    """
    Get file information from the database with error handling.
    Returns (file, None) on success or (None, (error_response, status_code)) on failure.
    """
    try:
        # Try to get the file from different tables
        file = None
        
        # Check uploaded files first
        file = File.query.get(file_id)
        
        # If not found, check created files
        if not file:
            file = CreatedFile.query.get(file_id)
            
        # If not found, check filled forms
        if not file:
            file = FilledForm.query.get(file_id)
            
        if not file:
            error_response = jsonify({'error': 'File not found'})
            return None, (error_response, 404)
            
        return file, None
        
    except Exception as e:
        error_response = jsonify({'error': f'Error retrieving file: {str(e)}'})
        return None, (error_response, 500)

@app.route('/api/check-file-exists/<file_id>', methods=['GET'])
@login_required
def check_file_exists(file_id):
    """
    Check if a file exists in the database before redirecting to edit form.
    This helps the frontend validate that a file exists before navigating.
    """
    app.logger.info(f"Checking file existence for ID: {file_id}")
    
    try:
        # Try to find the file in different tables
        file = CreatedFile.query.get(file_id)
        file_source = "created_file"
        
        if not file:
            file = FilledForm.query.get(file_id)
            file_source = "filled_form" if file else None
            
        if not file:
            file = File.query.get(file_id)
            file_source = "file" if file else None
        
        if file:
            # If file exists, check if the file path is valid
            file_path = getattr(file, 'file_path', None)
            file_exists = file_path and os.path.exists(file_path)
            
            # Check if it has a form definition
            has_form_def = False
            if hasattr(file, 'id'):
                form_def = FormDefinition.query.filter_by(file_id=file.id).first()
                has_form_def = form_def is not None
            
            app.logger.info(f"File found: type={file_source}, path_exists={file_exists}, has_form_def={has_form_def}")
            
            return jsonify({
                'exists': True,
                'file_path_exists': file_exists,
                'file_type': getattr(file, 'file_type', 'unknown'),
                'user_email': getattr(file, 'user_email', None),
                'file_source': file_source,
                'has_form_definition': has_form_def
            })
        else:
            app.logger.warning(f"File with ID {file_id} not found in any table")
            return jsonify({'exists': False, 'error': 'File not found'})
            
    except Exception as e:
        app.logger.error(f"Error checking file existence: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'exists': False, 'error': str(e)}), 500

def rebuild_submissions_table():
    """Rebuild the submissions table with the portfolio_id column."""
    app.logger.info("Rebuilding submissions table...")
    
    # Check if the table exists
    if db.engine.dialect.has_table(db.engine.connect(), 'submissions'):
        # Get all existing data
        try:
            # Get all existing submissions
            cursor = db.session.execute(text("SELECT id, user_email, filled_file_id, form_data, form_metadata, created_at FROM submissions"))
            submissions_data = cursor.fetchall()
            
            # Drop the table
            db.session.execute(text("DROP TABLE submissions"))
            db.session.commit()
            app.logger.info("Dropped submissions table")
            
            # Create the table with the new schema
            db.create_all()
            app.logger.info("Created new submissions table with portfolio_id column")
            
            # Restore the data
            for submission in submissions_data:
                # Create new submission with the existing data (portfolio_id will be NULL)
                db.session.execute(
                    text("INSERT INTO submissions (id, user_email, filled_file_id, form_data, form_metadata, created_at) VALUES (:id, :user_email, :filled_file_id, :form_data, :form_metadata, :created_at)"),
                    {
                        "id": submission[0],
                        "user_email": submission[1],
                        "filled_file_id": submission[2],
                        "form_data": submission[3],
                        "form_metadata": submission[4],
                        "created_at": submission[5]
                    }
                )
            db.session.commit()
            app.logger.info(f"Restored {len(submissions_data)} submissions")
            return True
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"Error rebuilding submissions table: {str(e)}")
            app.logger.error(traceback.format_exc())
            return False
    else:
        # Table doesn't exist, just create it
        db.create_all()
        app.logger.info("Created new submissions table with portfolio_id column")
        return True

# Update the check_and_update_database function to call rebuild_submissions_table
def check_and_update_database():
    """Check and update the database schema if needed."""
    # ... [existing code]
    
    # Check if the submissions table needs the portfolio_id column
    try:
        db.session.execute(text("SELECT portfolio_id FROM submissions LIMIT 1"))
        app.logger.info("submissions table already has portfolio_id column")
    except Exception:
        app.logger.warning("submissions table needs to be updated with portfolio_id column")
        rebuild_submissions_table()
        
    # ... [existing code]

# Register API blueprints
try:
    # Use absolute import with correct case sensitivity
    import sys
    import os
    
    # Get the absolute path to the current directory (with correct case)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
    
    # Now import the blueprint using the correct path
    from api_portfolio import portfolio_api
    app.register_blueprint(portfolio_api)
    app.logger.info("Registered portfolio API blueprint")
except ImportError as e:
    app.logger.error(f"Could not register portfolio API blueprint: {str(e)}")

# Register error logging API blueprint
try:
    # Use absolute import with correct case sensitivity
    from error_logging_api import error_logging_api
    app.register_blueprint(error_logging_api)
    app.logger.info("Registered error logging API blueprint")
except ImportError as e:
    app.logger.error(f"Could not register error logging API blueprint: {str(e)}")
    
# Register diagnostics API blueprint
try:
    # Use absolute import with correct case sensitivity
    from diagnostics_api import diagnostics_api
    app.register_blueprint(diagnostics_api)
    app.logger.info("Registered diagnostics API blueprint")
except ImportError as e:
    app.logger.error(f"Could not register diagnostics API blueprint: {str(e)}")

# Run the application when script is executed directly
if __name__ == "__main__":
    # Create all database tables if they don't exist
    with app.app_context():
        db.create_all()
    
    # Run the Flask application
    app.run(debug=True, host='0.0.0.0', port=5000)