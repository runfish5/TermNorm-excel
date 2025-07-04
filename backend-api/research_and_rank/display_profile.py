#@title def display_profile
def display_profile(entity_profile, title_prefix="COMPREHENSIVE ENTITY PROFILE"):
    """
    Format the research profile and return it as a string
    
    Args:
        entity_profile (dict): Research results from web_generate_entity_profile()
        title_prefix (str): Prefix for the display title
    
    Returns:
        str: Formatted profile string
    """
    
    if not entity_profile:
        return "❌ No profile data to display"

    lines = []
    
    # Header
    entity_name = entity_profile.get('entity_name', entity_profile.get('_metadata', {}).get('query', 'UNKNOWN'))
    lines.append(f"\n🎯 {title_prefix}: {entity_name.upper()}")
    lines.append("=" * 80)

    def format_dict_section(data_dict, section_name):
        section_lines = []
        if data_dict:
            section_lines.append(f"\n{section_name}:")
            for key, value in data_dict.items():
                if value:
                    clean_key = key.replace('_', ' ').title()
                    if isinstance(value, list):
                        if value:
                            section_lines.append(f"  • {clean_key}: {', '.join(str(x) for x in value)}")
                    else:
                        section_lines.append(f"  • {clean_key}: {value}")
        return section_lines

    # Handle flexible structure - check what fields we actually got
    for key, value in entity_profile.items():
        if key in ['entity_name', '_metadata']:
            continue
        elif isinstance(value, dict):
            lines.extend(format_dict_section(value, key.replace('_', ' ').title()))
        elif isinstance(value, list) and value:
            clean_key = key.replace('_', ' ').title()
            lines.append(f"\n{clean_key}:")
            for item in value:
                lines.append(f"  • {item}")
        elif value:
            clean_key = key.replace('_', ' ').title()
            lines.append(f"\n{clean_key}: {value}")

    return '\n'.join(lines)


