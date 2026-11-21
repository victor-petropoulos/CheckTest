from hypothesis import given, strategies as st

@given(st.integers())
def test_property_based(value):
    assert value == value
