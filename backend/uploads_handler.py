"""
Uploads Handler
--------------
This module provides functions for handling file uploads, specifically PDF and DOCX files.
It includes conversion from DOCX to PDF and file validation.
"""

import os
import uuid
import logging
from werkzeug.utils import secure_filename
from datetime import datetime
import pythoncom
from docx2pdf import convert as docx2pdf_convert
from pypdf import PdfReader

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# PDF Validation
def is_valid_pdf(file_path):
    """
    Check if a file is a valid PDF by attempting to open it with PdfReader.
    
    Args:
        file_path (str): Path to the PDF file
        
    Returns:
        bool: True if the file is a valid PDF, False otherwise
    """
    try:
        with open(file_path, 'rb') as f:
            reader = PdfReader(f)
            # Access a property to ensure it's readable
            num_pages = len(reader.pages)
            return True
    except Exception as e:
        logging.error(f"Invalid PDF file: {str(e)}")
        return False

# File Upload
def save_uploaded_file(file, upload_folder):
    """
    Save an uploaded file with a unique name.
    
    Args:
        file: Flask uploaded file object
        upload_folder (str): Directory path to save the file
        
    Returns:
        tuple: (saved_path, filename, file_ext)
    """
    # Create a unique filename with UUID
    unique_id = str(uuid.uuid4())
    original_filename = file.filename
    file_ext = os.path.splitext(original_filename)[1][1:].lower() if '.' in original_filename else ''
    
    unique_filename = f"{unique_id}.{file_ext}"
    
    # Ensure upload directory exists
    os.makedirs(upload_folder, exist_ok=True)
    
    # Path where file will be saved
    file_path = os.path.join(upload_folder, unique_filename)
    
    # Save the uploaded file
    file.save(file_path)
    logging.debug(f"File saved to: {file_path}")
    
    return file_path, unique_filename, file_ext

# DOCX to PDF Conversion
def convert_docx_to_pdf(docx_path, output_folder=None):
    """
    Convert a DOCX file to PDF.
    
    Args:
        docx_path (str): Path to the DOCX file
        output_folder (str, optional): Folder to save the PDF. If None,
                                       uses the same folder as docx_path
                                       
    Returns:
        str: Path to the generated PDF file, or None if conversion failed
    """
    try:
        # Initialize COM for docx2pdf (required for Windows)
        pythoncom.CoInitialize()
        
        # Generate PDF path
        if output_folder is None:
            output_folder = os.path.dirname(docx_path)
            
        base_name = os.path.basename(docx_path)
        file_name = os.path.splitext(base_name)[0]
        pdf_path = os.path.join(output_folder, f"{file_name}.pdf")
        
        # Convert DOCX to PDF
        logging.debug(f"Converting DOCX to PDF: {docx_path} -> {pdf_path}")
        docx2pdf_convert(docx_path, pdf_path)
        
        # Verify the PDF was created and is valid
        if os.path.exists(pdf_path) and is_valid_pdf(pdf_path):
            logging.debug("DOCX to PDF conversion successful")
            return pdf_path
        else:
            logging.error("PDF conversion completed but resulted in invalid PDF")
            return None
            
    except Exception as e:
        logging.error(f"Error during DOCX to PDF conversion: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        return None

# Get PDF Metadata
def get_pdf_metadata(pdf_path):
    """
    Extract metadata from a PDF file.
    
    Args:
        pdf_path (str): Path to the PDF file
        
    Returns:
        dict: PDF metadata including number of pages and dimensions
              or None if there was an error
    """
    try:
        with open(pdf_path, 'rb') as f:
            reader = PdfReader(f)
            num_pages = len(reader.pages)
            
            # Get page dimensions of first page
            first_page = reader.pages[0]
            width = float(first_page.mediabox.width)
            height = float(first_page.mediabox.height)
            
            return {
                'pages': num_pages,
                'width': width,
                'height': height,
                'is_valid': True
            }
    except Exception as e:
        logging.error(f"Error reading PDF metadata: {str(e)}")
        return None
