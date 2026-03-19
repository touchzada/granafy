"""Pure rule evaluation engine — no DB access."""
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.transaction import Transaction


def _to_decimal(val) -> Decimal:
    try:
        return Decimal(str(val))
    except InvalidOperation:
        return Decimal("0")


def _match_condition(condition: dict, tx: "Transaction") -> bool:
    field = condition.get("field", "")
    op = condition.get("op", "")
    value = condition.get("value")

    # Support nested dictionary lookups, e.g., "raw_data.description"
    if "." in field:
        parts = field.split(".")
        tx_val = getattr(tx, parts[0], None)
        for part in parts[1:]:
            if isinstance(tx_val, dict):
                tx_val = tx_val.get(part)
            else:
                tx_val = None
                break
    else:
        tx_val = getattr(tx, field, None)

    # String operators
    if op in ("contains", "not_contains", "starts_with", "ends_with", "equals", "not_equals", "regex"):
        tx_str = str(tx_val or "").upper()
        val_str = str(value or "").upper()

        if op == "contains":
            return val_str in tx_str
        if op == "not_contains":
            return val_str not in tx_str
        if op == "starts_with":
            return tx_str.startswith(val_str)
        if op == "ends_with":
            return tx_str.endswith(val_str)
        if op == "equals":
            return tx_str == val_str
        if op == "not_equals":
            return tx_str != val_str
        if op == "regex":
            try:
                return bool(re.search(str(value), str(tx_val or ""), re.IGNORECASE))
            except re.error:
                return False

    # Numeric operators
    if op in ("gt", "gte", "lt", "lte"):
        tx_num = _to_decimal(tx_val)
        val_num = _to_decimal(value)
        if op == "gt":
            return tx_num > val_num
        if op == "gte":
            return tx_num >= val_num
        if op == "lt":
            return tx_num < val_num
        if op == "lte":
            return tx_num <= val_num

    return False


def evaluate_conditions(conditions_op: str, conditions: list[dict], tx: "Transaction") -> bool:
    """Return True if the transaction matches the rule's conditions."""
    if not conditions:
        return False
    results = [_match_condition(c, tx) for c in conditions]
    if conditions_op == "or":
        return any(results)
    return all(results)  # "and" is default


def apply_rule_actions(
    actions: list[dict],
    tx: "Transaction",
    category_already_set: bool,
) -> bool:
    """Apply actions to transaction in-place. Returns updated category_already_set flag."""
    for action in actions:
        op = action.get("op")
        value = action.get("value")

        if op == "set_category" and not category_already_set:
            try:
                tx.category_id = uuid.UUID(str(value))
                category_already_set = True
            except (ValueError, AttributeError):
                pass

        elif op == "append_notes":
            new_tags = str(value or "").strip()
            if not new_tags:
                continue
            existing = tx.notes or ""
            if new_tags not in existing:
                tx.notes = (existing + " " + new_tags).strip() if existing else new_tags

    return category_already_set
