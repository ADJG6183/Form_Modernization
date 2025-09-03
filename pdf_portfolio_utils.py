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
    
    def create_form_field(self, canvas, field, page_height):
        """
        Create an individual form field on the canvas
        
        Args:
            canvas: ReportLab canvas object
            field: Field definition dict with properties (name, type, x, y, width, height, etc)
            page_height: Height of the PDF page for coordinate adjustment
            
        Returns:
            None (modifies canvas in-place)
        """
        field_name = field.get('name', '')
        field_type = field.get('type', 'text')
        x = field.get('x', 0)
        y = field.get('y', 0)
        width = field.get('width', 100)
        height = field.get('height', 20)
        
        # Adjust y-coordinate (PDF coordinates start from bottom)
        adjusted_y = page_height - y - height
        
        # Set up form
        form = AcroForm(canvas)
        
        # Add field based on type
        if field_type == 'text':
            canvas.rect(x, adjusted_y, width, height)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(x + 2, adjusted_y + height + 10, field_name)
            form.textfield(
                name=field_name,
                x=x,
                y=adjusted_y,
                width=width,
                height=height,
                tooltip=field.get('tooltip', field_name),
                readonly=field.get('read_only', False)
            )
        elif field_type == 'checkbox':
            canvas.rect(x, adjusted_y, width, height)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(x + 2, adjusted_y + height + 10, field_name)
            form.checkbox(
                name=field_name,
                x=x + width/4,
                y=adjusted_y + height/4,
                buttonStyle='check',
                borderColor='black',
                fillColor='white',
                textColor='black',
                width=width/2,
                height=height/2,
                tooltip=field.get('tooltip', field_name)
            )
        elif field_type == 'signature':
            canvas.rect(x, adjusted_y, width, height)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(x + 2, adjusted_y + height + 10, field_name)
            form.textfield(
                name=field_name,
                x=x,
                y=adjusted_y,
                width=width,
                height=height,
                tooltip=field.get('tooltip', f"Sign here: {field_name}")
            )
        elif field_type == 'date':
            canvas.rect(x, adjusted_y, width, height)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(x + 2, adjusted_y + height + 10, field_name)
            form.textfield(
                name=field_name,
                x=x,
                y=adjusted_y,
                width=width,
                height=height,
                tooltip=field.get('tooltip', "Enter date (MM/DD/YYYY)")
            )

    def create_surface_pdf_with_fields(self, base_pdf_path, fields, output_path=None):
        """
        Create a surface PDF with AcroForm fields
        
        Args:
            base_pdf_path: Path to the base PDF file
            fields: List of field definitions
            output_path: Optional path for output file
            
        Returns:
            output_path: Path to the created surface PDF
        """
        if not output_path:
            output_filename = f"{uuid.uuid4()}.pdf"
            output_path = os.path.join(self.created_dir, output_filename)
        
        logging.debug(f"Creating surface PDF with fields at {output_path}")
        
        try:
            # Create form fields overlay using ReportLab
            temp_file = BytesIO()
            c = canvas.Canvas(temp_file, pagesize=letter)
            c.setFont("Helvetica", 10)
            
            # Get original PDF dimensions
            with open(base_pdf_path, 'rb') as f:
                reader = PdfReader(f)
                
                # Process each page
                for page_num in range(len(reader.pages)):
                    # Get fields for this page
                    page_fields = [f for f in fields if f.get('page', 0) == page_num]
                    
                    # Create a new page if needed
                    if page_num > 0:
                        c.showPage()
                    
                    # Add fields to this page
                    page_height = 792  # Letter height in points
                    for field in page_fields:
                        self.create_form_field(c, field, page_height)
            
            # Save the form fields overlay
            c.save()
            
            # Merge with original PDF
            overlay_pdf = PdfReader(BytesIO(temp_file.getvalue()))
            original_pdf = PdfReader(base_pdf_path)
            writer = PdfWriter()
            
            # Merge each page
            for i in range(len(original_pdf.pages)):
                if i < len(overlay_pdf.pages):
                    page = original_pdf.pages[i]
                    page.merge_page(overlay_pdf.pages[i])
                    writer.add_page(page)
                else:
                    writer.add_page(original_pdf.pages[i])
            
            # Write output file
            with open(output_path, "wb") as output_file:
                writer.write(output_file)
                
            return output_path
            
        except Exception as e:
            logging.error(f"Error creating surface PDF with fields: {str(e)}")
            raise
    
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
                        
                        # Add field based on type
                        if field_type == 'text':
                            c.rect(x, adjusted_y, width, height)
                            c.setFont("Helvetica", 8)
                            c.drawString(x + 2, adjusted_y + height + 10, field_name)
                            # Add text form field
                            form = AcroForm(c)
                            form.textfield(
                                name=field_name,
                                x=x,
                                y=adjusted_y,
                                width=width,
                                height=height
                            )
                        elif field_type == 'checkbox':
                            c.rect(x, adjusted_y, width, height)
                            c.setFont("Helvetica", 8)
                            c.drawString(x + 2, adjusted_y + height + 10, field_name)
                            # Add checkbox form field
                            form = AcroForm(c)
                            form.checkbox(
                                name=field_name,
                                x=x + width/4,
                                y=adjusted_y + height/4,
                                buttonStyle='check',
                                borderColor='black',
                                fillColor='white',
                                textColor='black',
                                width=width/2,
                                height=height/2
                            )
            
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
                            
                            # Set the field value
                            field.update({
                                NameObject("/V"): create_string_object(field_value),
                                NameObject("/AS"): NameObject(field_value) if field.get("/FT") == "/Btn" else None
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
                
            return metadata
        
        except Exception as e:
            logging.error(f"Error extracting PDF metadata: {str(e)}")
            return {'error': str(e)}


# Instantiate a global generator for use throughout the application
surface_pdf_generator = SurfacePDFGenerator(
    upload_dir='uploads',
    created_dir='uploads/created',
    filled_dir='uploads/filled'
)
