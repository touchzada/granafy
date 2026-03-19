import asyncio
import uuid
from sqlalchemy import select
from app.core.database import get_async_session
from app.models.rule import Rule
from app.services.rule_service import get_rules, delete_rule

async def analyze_and_cleanup_rules():
    from app.models.user import User
    
    async with get_async_session() as session:
        result = await session.execute(select(User))
        user = result.scalars().first()
        if not user:
            print("No user found")
            return
            
        print(f"Analyzing rules for user: {user.email}")
        all_rules = await get_rules(session, user.id)
        print(f"Total rules: {len(all_rules)}")
        
        # Group rules by Action (category_id)
        action_groups = {}
        for rule in all_rules:
            if not rule.is_active: continue
            
            # Simplified action key (assuming only categorize_as for now)
            action_key = None
            for action in rule.actions:
                if action['op'] == 'categorize_as':
                    action_key = action['value']
                    break
            
            if not action_key: continue
            
            if action_key not in action_groups:
                action_groups[action_key] = []
            action_groups[action_key].append(rule)
            
        rules_to_delete = []
        
        for category_id, rules_in_cat in action_groups.items():
            if len(rules_in_cat) < 2: continue
            
            seen_conditions = {} # value -> rule_id
            
            for rule in rules_in_cat:
                if len(rule.conditions) == 1:
                    cond = rule.conditions[0]
                    if cond['field'] == 'description' and cond['op'] == 'contains':
                        val = cond['value'].strip().lower()
                        if val in seen_conditions:
                            print(f"Duplicate found: '{val}' already in rule {seen_conditions[val]}. Deleting rule {rule.id}")
                            rules_to_delete.append(rule.id)
                        else:
                            seen_conditions[val] = rule.id
                            
        # Execute cleanup
        deleted_count = 0
        for rid in rules_to_delete:
            try:
                await delete_rule(session, rid, user.id)
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting rule {rid}: {e}")
            
        await session.commit()
        print(f"Cleanup complete. Deleted {deleted_count} rules.")

if __name__ == "__main__":
    asyncio.run(analyze_and_cleanup_rules())
