"""Application identity; edit this one file when renaming the product."""
NAME = '集页'
ENGLISH_NAME = 'Jiye'
SLUG = 'jiye'
VERSION = '1.1.0'


def apply_identity(text):
    return (text.replace('__PRODUCT_NAME__', NAME)
            .replace('__PRODUCT_ENGLISH__', ENGLISH_NAME)
            .replace('__PRODUCT_VERSION__', VERSION))
