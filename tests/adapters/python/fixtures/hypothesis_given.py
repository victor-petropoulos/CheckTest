from hypothesis import given, strategies as st


@given(st.integers())
def test_hypothesis(x):
    assert x + 0 == x
