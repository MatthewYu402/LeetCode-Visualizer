class Solution {
public:
    vector<int> preorderTraversal(TreeNode* root) {
        vector<int> result;
        if (root == nullptr) {
            return result;
        }

        stack<TreeNode*> st;
        st.push(root);

        while (!st.empty()) {
            TreeNode* curr = st.top();
            st.pop();
            result.push_back(curr->val);

            if (curr->right != nullptr) {
                st.push(curr->right);
            }
            if (curr->left != nullptr) {
                st.push(curr->left);
            }
        }
        return result;
    }
};
