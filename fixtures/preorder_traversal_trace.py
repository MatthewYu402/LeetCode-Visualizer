# Definition for a binary tree node.
# class TreeNode:
#     def __init__(self, val=0, left=None, right=None):
#         self.val = val
#         self.left = left
#         self.right = right
class Solution:
    def preorderTraversal(self, root: Optional[TreeNode]) -> List[int]:
        result = []
        if root is None:
            return result

        st = []
        st.append(root)

        while st:
            curr = st.pop()
            result.append(curr.val)

            if curr.right is not None:
                st.append(curr.right)
            if curr.left is not None:
                st.append(curr.left)
        return result
