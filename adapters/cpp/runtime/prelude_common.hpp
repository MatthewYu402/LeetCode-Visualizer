// prelude_common.hpp: the part of every generated prelude that never changes.
//
// The standard headers a LeetCode C++ solution may use without including them,
// and the runtime (leetcode_types.hpp brings ListNode, TreeNode, and trace.hpp).
// The driver's prelude.hpp includes this file first, then adds what depends on
// the problem: `using namespace std;` and the node classes from comments.
//
// Every standard header is named, because <bits/stdc++.h> does not exist in
// libc++ (macOS).
//
// The sandbox image compiles this file once into a precompiled header,
// prelude_common.hpp.pch (sandbox/Dockerfile), so a run does not parse it
// again in the rewriter and again in the compiler. Change it here only: the
// image is rebuilt from this file.

#ifndef TRACE_PRELUDE_COMMON_HPP
#define TRACE_PRELUDE_COMMON_HPP

#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "leetcode_types.hpp"  // ListNode, TreeNode, and trace.hpp

#endif  // TRACE_PRELUDE_COMMON_HPP
