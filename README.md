# PDF Form Digitalization System

A comprehensive PDF form management system for creating, editing, filling, and managing PDF forms. This project provides a web-based interface for PDF form creation, field management, and form filling.

## Features

- **PDF Form Editor**: Create and edit PDF forms with various field types
- **Portfolio Approach**: Manage PDF forms as portfolios with base and surface files
- **Form Filling**: Fill out PDF forms with validation and data persistence
- **Diagnostics & Error Handling**: Built-in tools for troubleshooting and error reporting
- **User Authentication**: Role-based access control for form management
- **Form Submissions**: Track and manage form submissions

## System Requirements

- Python 3.9+
- Windows with Python win32 support (for docx2pdf)
- Modern web browser (Chrome, Firefox, or Edge recommended)

## Installation

1. Clone the repository
2. Install requirements:
   ```
   pip install -r requirements.txt
   ```
3. Run the application:
   ```
   cd Form-managment/public/Index
   python app.py
   ```

## Project Structure

- `/Form-management`: Main application code
  - `/public/Index`: Web application
    - `/backend`: Python backend code
    - `/static`: Frontend assets (CSS, JS)
    - `/templates`: HTML templates
    - `/uploads`: PDF file storage
    - `/instance`: Database storage
  - `/tests`: Test suite and testing utilities

## PDF Portfolio Approach

This project uses a "PDF Portfolio" approach where:

1. **Base PDF**: The original uploaded PDF document
2. **Surface PDF**: A generated PDF with AcroForm fields overlaid
3. **Field Definitions**: JSON data defining field positions and properties

This approach allows separation of concerns between the document itself and the form fields added to it.

## Development

### Testing

Run the test suite:

```
cd Form-management/tests
pytest test_app.py
```

Run with coverage:

```
pytest --cov=../public/Index test_app.py
```

### Debugging

The application includes built-in diagnostic tools:
- Debug modal in the editor UI
- Error logging API for frontend errors
- PDF loading and field diagnostics
- System information reporting

## License

Copyright © 2025 " 

