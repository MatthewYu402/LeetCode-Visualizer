"""Stage 1: example text -> neutral JSON (driver/example.py)."""

import unittest

from driver import DriverError
from driver.example import parse_example


class ParseExample(unittest.TestCase):
    def test_two_params(self):
        self.assertEqual(parse_example("nums = [2,7,11,15], target = 9"), {"nums": [2, 7, 11, 15], "target": 9})

    def test_keeps_the_order_written(self):
        self.assertEqual(list(parse_example("b = 1, a = 2")), ["b", "a"])

    def test_pasted_block_with_input_and_output(self):
        text = "Input: nums = [3,2,4], target = 6\nOutput: [1,2]\nExplanation: nums[1] + nums[2] == 6"
        self.assertEqual(parse_example(text), {"nums": [3, 2, 4], "target": 6})

    def test_nested_arrays_null_bool_float(self):
        self.assertEqual(parse_example("root = [1,null,2,3], flag = true, x = 2.5, grid = [[1,0],[0,1]]"),
                         {"root": [1, None, 2, 3], "flag": True, "x": 2.5, "grid": [[1, 0], [0, 1]]})

    def test_commas_and_brackets_inside_strings(self):
        self.assertEqual(parse_example('s = "a,b]", t = "say \\"hi\\""'), {"s": "a,b]", "t": 'say "hi"'})

    def test_char_grid(self):
        self.assertEqual(parse_example('board = [["5","."],[".","3"]]'), {"board": [["5", "."], [".", "3"]]})

    def test_multiline(self):
        self.assertEqual(parse_example("a = [1,\n 2],\n b = 3"), {"a": [1, 2], "b": 3})

    def test_errors(self):
        cases = {
            "": "empty",
            "nums [1,2]": "expected name = value",
            "1x = 3": "not a parameter name",
            "a = 1, a = 2": "twice",
            "a = [1,2": "unclosed",
            "a = 1]": "unmatched",
            'a = "abc': "no closing quote",
            "a = [1,,2]": "not valid",
            "a = NaN": "not valid",
            "a = 'x'": "not valid",
        }
        for text, message in cases.items():
            with self.subTest(text=text):
                with self.assertRaisesRegex(DriverError, message):
                    parse_example(text)


if __name__ == "__main__":
    unittest.main()
