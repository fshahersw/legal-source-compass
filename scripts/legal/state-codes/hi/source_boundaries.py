"""Narrow publisher markup exceptions proved by native identity and source form."""
import re

# Reviewed original response bytes. This page places its leading statutory
# paragraph in XNotes but follows it with actual editorial annotations.
# A changed response must be reviewed again; neither its URL nor CSS alone is
# permission to reclassify a paragraph.
REVIEWED_LEADING_XNOTES={
    'HRS_0342H-0011.htm':'2f6340235377b530b50ffc38bd511c06a11f66f5c842c4610c72ee7da8d01d3b',
}


def statutory_xnotes_exception(container,filename,source_sha256):
    """Some observed HRS pages style their statutory paragraph as XNotes.

    Recognize that form only when there is one nonempty paragraph, all printed
    container text belongs to it, and its leading bold citation matches the exact
    simple publisher filename. The separately reviewed response hash above may
    also retain its leading statute while keeping later notes separate. Never
    reclassify a different citation or an unreviewed multi-paragraph ambiguity.
    The returned element remains original source text, with no legal-force claim.
    """
    native=re.fullmatch(r'HRS_0*([0-9]+[A-Za-z]*)-0*([0-9]+[A-Za-z]*)(?:_0*([0-9]+[A-Za-z]*))?\.htm',filename)
    if not native:return None
    containers=[el for el in container.getroottree().xpath('//div[@class]')if any(
        re.fullmatch(r'WordSection[0-9]+',c)for c in el.get('class').split())]
    if len(containers)!=1:return None
    expected=native.group(1)+'-'+native.group(2)+('.'+native.group(3)if native.group(3)else'')
    paragraphs=[el for el in container.xpath('.//p')if el.text_content().strip()]
    reviewed=REVIEWED_LEADING_XNOTES.get(filename)==source_sha256
    if not paragraphs or (len(paragraphs)!=1 and not reviewed):return None
    paragraph=paragraphs[0]
    if 'xnotes'not in {c.casefold()for c in (paragraph.get('class')or'').split()}:return None
    stripped=lambda text:re.sub(r'\s','',text)
    if not reviewed and stripped(container.text_content())!=stripped(paragraph.text_content()):return None
    if reviewed and any(not any(c.casefold().startswith('xnotes')for c in (el.get('class')or'').split())for el in paragraphs[1:]):return None
    prefix=re.compile(r'^\s*\[?\s*§\s*'+re.escape(expected)+r'\]?(?:\s|$)')
    bold=''.join(el.text_content()for el in paragraph.xpath('.//b | .//strong'))
    return paragraph if prefix.match(paragraph.text_content())and prefix.match(bold)else None
