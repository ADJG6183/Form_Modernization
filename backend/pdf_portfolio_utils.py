"""
PDF Portfolio Management Utilities

This module provides utilities for:
1. Creating blank "surface" PDFs with AcroForm fields
2. Filling form fields in a surface PDF
3. Managing PDF portfolio relationships
"""

import os
import uuid
import json
import logging
from datetime import datetime
from io import BytesIO
from pathlib import Path

# PDF manipulation libraries
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.acroform import AcroForm
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject, create_string_object, BooleanObject
from PyPDFForm import PdfWrapper


# Field rendering helper functions
def render_text_field(canvas_obj, field_data, adjusted_y):
    """
    Render a text field on the PDF canvas
    
    Args:
        canvas_obj: ReportLab canvas object
        field_data: Dictionary with field properties
        adjusted_y: Y coordinate adjusted for PDF coordinate system
    """
    x = field_data.get('x', 0)
    y = adjusted_y
    width = field_data.get('width', 100)
    height = field_data.get('height', 20)
    field_name = field_data.get('name', '')
    
    # Draw field border and label
    canvas_obj.rect(x, y, width, height)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(x + 2, y + height + 10, field_name)
    
    # Add text form field
    form = AcroForm(canvas_obj)
    form.textfield(
        name=field_name,
        x=x,
        y=y,
        width=width,
        height=height,
        borderWidth=1,
        borderColor=field_data.get('border_color', 'black'),
        fillColor=field_data.get('fill_color', 'white'),
        textColor=field_data.get('text_color', 'black'),
        fontSize=field_data.get('font_size', 10),
    )

def render_checkbox_field(canvas_obj, field_data, adjusted_y):
    """
    Render a checkbox field on the PDF canvas
    
    Args:
        canvas_obj: ReportLab canvas object
        field_data: Dictionary with field properties
        adjusted_y: Y coordinate adjusted for PDF coordinate system
    """
    x = field_data.get('x', 0)
    y = adjusted_y
    width = field_data.get('width', 100)
    height = field_data.get('height', 20)
    field_name = field_data.get('name', '')
    
    # Draw field border and label
    canvas_obj.rect(x, y, width, height)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(x + 2, y + height + 10, field_name)
    
    # Add checkbox form field with improved layout
    form = AcroForm(canvas_obj)
    form.checkbox(
        name=field_name,
        x=x + width/4,
        y=y + height/4,
        buttonStyle=field_data.get('button_style', 'check'),
        borderColor=field_data.get('border_color', 'black'),
        fillColor=field_data.get('fill_color', 'white'),
        textColor=field_data.get('text_color', 'black'),
        width=width/2,
        height=height/2
    )

def render_radio_field(canvas_obj, field_data, adjusted_y):
    """
    Render a radio button field on the PDF canvas
    
    Args:
        canvas_obj: ReportLab canvas object
        field_data: Dictionary with field properties
        adjusted_y: Y coordinate adjusted for PDF coordinate system
    """
    x = field_data.get('x', 0)
    y = adjusted_y
    width = field_data.get('width', 100)
    height = field_data.get('height', 20)
    field_name = field_data.get('name', '')
    
    # Draw field border and label
    canvas_obj.rect(x, y, width, height)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(x + 2, y + height + 10, field_name)
    
    # Add radio form field
    form = AcroForm(canvas_obj)
    form.radio(
        name=field_name,
        value=field_data.get('value', 'Option'),
        x=x + width/4,
        y=y + height/4,
        buttonStyle=field_data.get('button_style', 'circle'),
        borderColor=field_data.get('border_color', 'black'),
        fillColor=field_data.get('fill_color', 'white'),
        textColor=field_data.get('text_color', 'black'),
        width=width/2,
        height=height/2
    )

def render_signature_field(canvas_obj, field_data, adjusted_y):
    """
    Render a signature field on the PDF canvas
    
    Args:
        canvas_obj: ReportLab canvas object
        field_data: Dictionary with field properties
        adjusted_y: Y coordinate adjusted for PDF coordinate system
    """
    x = field_data.get('x', 0)
    y = adjusted_y
    width = field_data.get('width', 200)
    height = field_data.get('height', 50)
    field_name = field_data.get('name', '')
    
    # Draw field border with dashed lines
    canvas_obj.setDash([3, 3])
    canvas_obj.rect(x, y, width, height)
    canvas_obj.setDash([])  # Reset dash pattern
    
    # Add label
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(x + 2, y + height + 10, field_name)
    
    # Draw signature line
    line_y = y + (height * 0.25)
    canvas_obj.line(x + 10, line_y, x + width - 10, line_y)
    
    # Add signature text field
    form = AcroForm(canvas_obj)
    form.textfield(
        name=field_name,
        x=x,
        y=y,
        width=width,
        height=height,
        borderWidth=0,  # No border since we drew it custom
        fillColor=field_data.get('fill_color', 'white'),
        textColor=field_data.get('text_color', 'black'),
        fontSize=field_data.get('font_size', 10),
    )


class SurfacePDFGenerator:
    """Generates blank surface PDFs with AcroForm fields"""
    
    def __init__(self, upload_dir='uploads', created_dir='uploads/created', filled_dir='uploads/filled'):
        """
        Initialize the generator with configurable paths
        
        Args:
            upload_dir: Directory for uploaded files
            created_dir: Directory for created surface PDFs
            filled_dir: Directory for filled PDFs
        """
        self.upload_dir = upload_dir
        self.created_dir = created_dir
        self.filled_dir = filled_dir
        
        # Ensure directories exist
        os.makedirs(self.upload_dir, exist_ok=True)
        os.makedirs(self.created_dir, exist_ok=True)
        os.makedirs(self.filled_dir, exist_ok=True)
        
        logging.debug(f"SurfacePDFGenerator initialized with: upload_dir={upload_dir}, "
                     f"created_dir={created_dir}, filled_dir={filled_dir}")
    
    def create_surface_pdf(self, base_pdf_path, form_fields, output_path=None):
        """
        Create a surface PDF with AcroForm fields based on a base PDF
        
        Args:
            base_pdf_path: Path to the base PDF file
            form_fields: List of field definitions to add to the PDF
            output_path: Optional path for the output file. If None, generates one in created_dir
            
        Returns:
            output_path: Path to the created surface PDF
        """
        if not output_path:
            output_filename = f"{uuid.uuid4()}.pdf"
            output_path = os.path.join(self.created_dir, output_filename)
        
        logging.debug(f"Creating surface PDF at {output_path} from base {base_pdf_path}")
        logging.debug(f"Adding {len(form_fields)} form fields")
        
        # Create PDF fields using reportlab for field creation
        try:
            # First create a PDF with fields using reportlab
            temp_file = BytesIO()
            c = canvas.Canvas(temp_file, pagesize=letter)
            
            # Set up basic form field formatting
            c.setFont("Helvetica", 10)
            
            # Get original PDF dimensions to match form fields correctly
            with open(base_pdf_path, 'rb') as f:
                reader = PdfReader(f)
                
                # For each page, create a new page in the output PDF
                for page_num in range(len(reader.pages)):
                    # Only add fields for the requested page
                    page_fields = [f for f in form_fields if f.get('page', 0) == page_num]
                    
                    # If we have fields for this page, add them
                    if page_num > 0:  # If not the first page, create a new page
                        c.showPage()
                    
                    # For each field on this page, add it
                    for field in page_fields:
                        field_name = field.get('name', '')
                        field_type = field.get('type', 'text')
                        x = field.get('x', 0)
                        y = field.get('y', 0)  # PDF coordinates are from bottom-left
                        width = field.get('width', 100)
                        height = field.get('height', 20)
                        
                        # Adjust y-coordinate (PDF coordinates start from bottom)
                        page_height = 792  # Letter height in points
                        adjusted_y = page_height - y - height
                        
                        # Use the appropriate field renderer based on type
                        if field_type == 'text':
                            render_text_field(c, field, adjusted_y)
                        elif field_type == 'checkbox':
                            render_checkbox_field(c, field, adjusted_y)
                        elif field_type == 'radio':
                            render_radio_field(c, field, adjusted_y)
                        elif field_type == 'signature':
                            render_signature_field(c, field, adjusted_y)
            
            # Save the canvas with form fields
            c.save()
            
            # Now merge with original PDF
            overlay_pdf = PdfReader(BytesIO(temp_file.getvalue()))
            original_pdf = PdfReader(base_pdf_path)
            writer = PdfWriter()
            
            # For each page, merge the original with our form field overlay
            for i in range(len(original_pdf.pages)):
                if i < len(overlay_pdf.pages):
                    page = original_pdf.pages[i]
                    page.merge_page(overlay_pdf.pages[i])
                    writer.add_page(page)
                else:
                    writer.add_page(original_pdf.pages[i])
            
            # Save the merged PDF to the output path
            with open(output_path, "wb") as output_file:
                writer.write(output_file)
            
            logging.info(f"Surface PDF created successfully: {output_path}")
            return output_path
            
        except Exception as e:
            logging.error(f"Error creating surface PDF: {str(e)}")
            raise
    
    def fill_surface_pdf(self, surface_pdf_path, form_data, output_path=None):
        """
        Fill a surface PDF with form data and generate a filled PDF
        
        Args:
            surface_pdf_path: Path to the surface PDF with AcroForm fields
            form_data: Dictionary of field names and values
            output_path: Optional path for the output file. If None, generates one in filled_dir
            
        Returns:
            output_path: Path to the filled PDF
        """
        if not output_path:
            output_filename = f"filled_{uuid.uuid4()}.pdf"
            output_path = os.path.join(self.filled_dir, output_filename)
        
        logging.debug(f"Filling surface PDF {surface_pdf_path} with data, output to {output_path}")
        
        try:
            # Fill the form using PyPDF
            reader = PdfReader(surface_pdf_path)
            writer = PdfWriter()
            
            # Get form fields from the PDF
            form_fields = reader.get_fields()
            
            # Copy all pages
            for page_num, page in enumerate(reader.pages):
                writer.add_page(page)
            
            # Get the AcroForm from the source document
            if "/AcroForm" in reader.trailer["/Root"]:
                writer._root_object.update({
                    NameObject("/AcroForm"): reader.trailer["/Root"]["/AcroForm"]
                })
                
                # Fill form fields with data provided
                if form_data:
                    for field_name, field_value in form_data.items():
                        if field_name in form_fields:
                            # Update the field value in the PDF
                            field_key = list(form_fields[field_name].keys())[0]
                            field_ref = form_fields[field_name][field_key]
                            field = reader.get_object(field_ref)
                            
                            # Handle different field types appropriately
                            if field.get("/FT") == "/Btn":
                                # Checkbox or radio button
                                if isinstance(field_value, bool):
                                    # Convert boolean to proper checkbox value
                                    field_value = "Yes" if field_value else "Off"
                                field.update({
                                    NameObject("/V"): NameObject(f"/{field_value}"),
                                    NameObject("/AS"): NameObject(f"/{field_value}")
                                })
                            else:
                                # Text fields
                                field.update({
                                    NameObject("/V"): create_string_object(str(field_value)),
                                    NameObject("/AP"): None
                                })
            
            # Write the output PDF
            with open(output_path, "wb") as output_file:
                writer.write(output_file)
            
            logging.info(f"Form filled successfully: {output_path}")
            return output_path
            
        except Exception as e:
            logging.error(f"Error filling PDF form: {str(e)}")
            raise
    
    def extract_pdf_metadata(self, pdf_path):
        """
        Extract metadata from a PDF file
        
        Args:
            pdf_path: Path to the PDF file
            
        Returns:
            dict: Dictionary of PDF metadata
        """
        metadata = {}
        try:
            with open(pdf_path, 'rb') as f:
                reader = PdfReader(f)
                info = reader.metadata
                
                if info:
                    for key in info:
                        metadata[key] = info[key]
                
                # Add additional metadata
                metadata['pages'] = len(reader.pages)
                metadata['has_form'] = bool(reader.get_fields())
                metadata['extracted_at'] = datetime.utcnow().isoformat()
                
                # Count field types
                field_count = {
                    'text': 0,
                    'checkbox': 0,
                    'radio': 0,
                    'signature': 0,
                    'other': 0
                }
                
                # Get all form fields
                fields = reader.get_fields()
                if fields:
                    for field_name, field_refs in fields.items():
                        # Get the field object
                        field_key = list(field_refs.keys())[0]
                        field_ref = field_refs[field_key]
                        field = reader.get_object(field_ref)
                        
                        # Determine field type
                        if field.get("/FT") == "/Tx":  # Text
                            field_count['text'] += 1
                        elif field.get("/FT") == "/Btn":  # Button (checkbox or radio)
                            if field.get("/Ff", 0) & (1 << 15):  # Radio button
                                field_count['radio'] += 1
                            else:  # Checkbox
                                field_count['checkbox'] += 1
                        else:
                            field_count['other'] += 1
                
                metadata['field_count'] = field_count
                metadata['total_fields'] = sum(field_count.values())
                
            return metadata
        
        except Exception as e:
            logging.error(f"Error extracting PDF metadata: {str(e)}")
            return {'error': str(e)}
    
    def validate_pdf_portfolio(self, portfolio_data):
        """
        Validate PDF portfolio data structure
        
        Args:
            portfolio_data: Dictionary with portfolio data
            
        Returns:
            tuple: (valid, errors) where valid is a boolean and errors is a list of error messages
        """
        errors = []
        
        # Check required fields
        required_fields = ['surface_file_id', 'base_file_id', 'name']
        for field in required_fields:
            if field not in portfolio_data:
                errors.append(f"Missing required field: {field}")
                
        # Validate file IDs exist
        if 'surface_file_id' in portfolio_data and not isinstance(portfolio_data['surface_file_id'], int):
            errors.append("surface_file_id must be an integer")
            
        if 'base_file_id' in portfolio_data and not isinstance(portfolio_data['base_file_id'], int):
            errors.append("base_file_id must be an integer")
        
        # Check if fields array is valid
        if 'fields' in portfolio_data:
            if not isinstance(portfolio_data['fields'], list):
                errors.append("fields must be a list")
            else:
                # Check each field has required properties
                for i, field in enumerate(portfolio_data['fields']):
                    if not isinstance(field, dict):
                        errors.append(f"Field at index {i} must be an object")
                        continue
                        
                    # Check required field properties
                    if 'name' not in field:
                        errors.append(f"Field at index {i} missing required property: name")
                        
                    if 'type' not in field:
                        errors.append(f"Field at index {i} missing required property: type")
                    elif field['type'] not in ['text', 'checkbox', 'radio', 'signature']:
                        errors.append(f"Field at index {i} has invalid type: {field['type']}")
                        
                    # Check coordinates
                    for coord in ['x', 'y', 'width', 'height']:
                        if coord not in field:
                            errors.append(f"Field '{field.get('name', f'at index {i}')}' missing required property: {coord}")
                        elif not isinstance(field[coord], (int, float)):
                            errors.append(f"Field '{field.get('name', f'at index {i}')}' {coord} must be a number")
                    
                    # Check page number
                    if 'page' not in field:
                        errors.append(f"Field '{field.get('name', f'at index {i}')}' missing required property: page")
                    elif not isinstance(field['page'], int) or field['page'] < 0:
                        errors.append(f"Field '{field.get('name', f'at index {i}')}' page must be a non-negative integer")
        
        return len(errors) == 0, errors


# Instantiate a global generator for use throughout the application
surface_pdf_generator = SurfacePDFGenerator(
    upload_dir='uploads',
    created_dir='uploads/created',
    filled_dir='uploads/filled'
)
